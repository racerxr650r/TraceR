#!/usr/bin/env python3
"""
project_io.py — long-running JSON-RPC 2.0 server over stdin/stdout for
the TraceR Project.xml toolchain.

The server exposes the four importable functions in render_doc.py and
lint_project.py as JSON-RPC methods:

  * lint(xml_path?, xsd_path?, show_warnings?=True)
        -> {"errors": [...], "warnings": [...], "notes": [...],
            "ok": bool}
  * render(template, metadata_id, xml_path?, out?)
        -> {"output": "<rendered markdown>", "out_path": null|"..."}
  * parse_to_json(xml_path?, metadata_for?)
        -> {parsed Project.xml as a JSON-serialisable tree}
  * list_documents(xml_path?)
        -> {"documents": [{"id", "title", "source", "version",
                           "date", "author", "template", "output"},
                          ...]}
  * ui_hints_index(xsd_path?)
        -> {"ui_hints_index": {<ComplexTypeName>: {tree_node, form,
                               lenses, document}, ...}}
  * init_project(name, short_name, author?, xml_path?, pvd_path?,
                 pvd_template?, force?=False)
        -> {"xml_path": "...", "pvd_path": "...", "existing": [...]}
  * apply_edit(operations, xml_path?, xsd_path?, expect_clean?=True)
        -> {"ok": bool, "written": bool, "findings": {...},
            "operations_applied": int}
        Phase 3 write surface (HLR-018, HLR-019). The on-disk file is
        byte-identical to its pre-call state when validation fails.
  * form_schema(type, xsd_path?, refs?)
        -> {"schema": {...}, "uiSchema": {...}, "fields": [...],
            "type": "..."}
        Derive a JSON Schema + RJSF uiSchema for the form webview.
  * next_free_id(kind, function?, xml_path?)
        -> {"id": "HLR-NNN" | "LLR-XXX-NN"}
        Allocate the next-free id (HLR-005)..

Wire format
-----------
Requests are line-delimited JSON objects on stdin (one request per
line). Responses are line-delimited JSON objects on stdout (one
response per request). This matches the convention used by Microsoft's
language servers when not using Content-Length framing and keeps the
acceptance test trivial:

    echo '{"method":"lint"}' | python3 tools/project_io.py

Each request follows JSON-RPC 2.0:
    {"jsonrpc": "2.0", "id": 1, "method": "lint", "params": {...}}

The "jsonrpc" field is optional (defaulted to "2.0") and "id" is
optional (defaulted to null) so that ad-hoc usage from the shell
remains ergonomic. Notifications (id missing AND jsonrpc=="2.0")
suppress the response, matching the JSON-RPC 2.0 spec.

Errors are returned as standard JSON-RPC error objects with codes:
   -32700 parse error          (malformed JSON on a request line)
   -32600 invalid request      (missing method, wrong types)
   -32601 method not found
   -32602 invalid params       (missing required arg, wrong type)
   -32603 internal error       (uncaught exception in the handler)
   -32000 application error    (e.g. ProjectXmlError)

Exit codes
----------
   0  Stdin reached EOF cleanly.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Callable

# Importable functions from the refactored CLI tools.
from render_doc import (
    PROJECT_XML,
    PROJECT_XSD,
    PVD_TEMPLATE,
    ProjectXmlError,
    collect_nodes_by_type as _collect_nodes_by_type,
    init_project as _init_project,
    list_documents as _list_documents,
    parse_project_to_dict as _parse_project_to_dict,
    parse_ui_hints_index as _parse_ui_hints_index,
    render_document as _render_document,
)
from lint_project import (
    DEFAULT_XML as LINT_DEFAULT_XML,
    DEFAULT_XSD as LINT_DEFAULT_XSD,
    lint as _lint,
)
from project_edit import (
    apply_edit as _apply_edit,
    derive_form_schema as _derive_form_schema,
    next_free_hlr_id as _next_free_hlr_id,
    next_free_llr_id as _next_free_llr_id,
)

# JSON-RPC error codes (https://www.jsonrpc.org/specification#error_object).
PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
INTERNAL_ERROR = -32603
APPLICATION_ERROR = -32000


# --------------------------------------------------------------------- #
# Method handlers. Each takes a params dict and returns a JSON-able     #
# result (or raises ProjectXmlError / ValueError on user-facing errors).#
# --------------------------------------------------------------------- #

def _as_path(value: Any, default: Path) -> Path:
    if value is None:
        return Path(default)
    if not isinstance(value, str):
        raise ValueError(f"expected string path, got {type(value).__name__}")
    return Path(value)


def _method_lint(params: dict[str, Any]) -> dict[str, Any]:
    xml_path = _as_path(params.get("xml_path"), LINT_DEFAULT_XML)
    xsd_path = _as_path(params.get("xsd_path"), LINT_DEFAULT_XSD)
    findings = _lint(xml_path, xsd_path)
    result = findings.to_dict()
    result["ok"] = not findings.errors
    return result


def _method_render(params: dict[str, Any]) -> dict[str, Any]:
    if "template" not in params or "metadata_id" not in params:
        raise ValueError("render requires 'template' and 'metadata_id'")
    template = _as_path(params["template"], Path())
    metadata_id = params["metadata_id"]
    if not isinstance(metadata_id, str):
        raise ValueError("metadata_id must be a string")
    xml_path = _as_path(params.get("xml_path"), PROJECT_XML)
    output = _render_document(template, metadata_id, xml_path)
    out_path = params.get("out")
    if out_path is not None:
        if not isinstance(out_path, str):
            raise ValueError("out must be a string path or null")
        Path(out_path).write_text(output)
    return {"output": output, "out_path": out_path}


def _method_parse_to_json(params: dict[str, Any]) -> dict[str, Any]:
    xml_path = _as_path(params.get("xml_path"), PROJECT_XML)
    metadata_for = params.get("metadata_for")
    if metadata_for is not None and not isinstance(metadata_for, str):
        raise ValueError("metadata_for must be a string or null")
    project = _parse_project_to_dict(xml_path, metadata_for)
    # Phase 2.5b: embed the UI hint index distilled from the XSD
    # alongside the parsed tree so a single round trip gives the
    # extension everything it needs to render schema-driven surfaces.
    # Underscore-prefixed key keeps it out of band of the payload.
    hints_index = _parse_ui_hints_index(PROJECT_XSD)
    project["_ui_hints_index"] = hints_index
    # Slice D: also embed a generic node index keyed by the same
    # complex-type name, so consumers (e.g. the VS Code tree provider)
    # can iterate every payload that carries a `ui:treeNode` hint
    # without special-casing per-tag builders.
    project["_nodes"] = _collect_nodes_by_type(xml_path, hints_index)
    return project


def _method_list_documents(params: dict[str, Any]) -> dict[str, Any]:
    xml_path = _as_path(params.get("xml_path"), PROJECT_XML)
    return {"documents": _list_documents(xml_path)}


def _method_ui_hints_index(params: dict[str, Any]) -> dict[str, Any]:
    """Phase 2.5b JSON-RPC surface: distil the per-complex-type UI
    hint vocabulary from ``tools/project.xsd`` (`<xs:appinfo>` blocks)
    and return a JSON-serialisable index keyed by complex-type name.
    Used by the VS Code extension's tree provider, lens provider,
    locator, and Phase 3 form panels.

    See doc/Schema_Reference.md §16 for the vocabulary contract and
    §9 for the Renderer Data Surface field.
    """
    xsd_path = _as_path(params.get("xsd_path"), PROJECT_XSD)
    return {"ui_hints_index": _parse_ui_hints_index(xsd_path)}


def _method_init_project(params: dict[str, Any]) -> dict[str, Any]:
    if "name" not in params or "short_name" not in params:
        raise ValueError("init_project requires 'name' and 'short_name'")
    name = params["name"]
    short_name = params["short_name"]
    if not isinstance(name, str) or not isinstance(short_name, str):
        raise ValueError("name and short_name must be strings")
    author = params.get("author", "TBD")
    if not isinstance(author, str):
        raise ValueError("author must be a string")
    xml_path = _as_path(params.get("xml_path"), PROJECT_XML)
    pvd_path = params.get("pvd_path")
    if pvd_path is not None:
        pvd_path = Path(pvd_path)
    pvd_template = _as_path(params.get("pvd_template"), PVD_TEMPLATE)
    force = bool(params.get("force", False))
    return _init_project(
        name=name,
        short_name=short_name,
        author=author,
        xml_path=xml_path,
        pvd_path=pvd_path,
        pvd_template=pvd_template,
        force=force,
    )


def _method_apply_edit(params: dict[str, Any]) -> dict[str, Any]:
    """Phase 3 write surface (HLR-018, HLR-019). Applies a list of
    JSON-Patch-like operations to ``Project.xml``, validates the
    candidate against the XSD + linter, and only writes the file on a
    clean result. The on-disk file is byte-identical to its pre-call
    state when validation fails.
    """
    operations = params.get("operations")
    if operations is None:
        raise ValueError("apply_edit requires 'operations'")
    if not isinstance(operations, list):
        raise ValueError("'operations' must be a list")
    xml_path = _as_path(params.get("xml_path"), PROJECT_XML)
    xsd_path = _as_path(params.get("xsd_path"), PROJECT_XSD)
    expect_clean = params.get("expect_clean", True)
    if not isinstance(expect_clean, bool):
        raise ValueError("'expect_clean' must be a boolean")
    result = _apply_edit(
        operations,
        xml_path=xml_path,
        xsd_path=xsd_path,
        expect_clean=expect_clean,
    )
    return result.to_dict()


def _method_form_schema(params: dict[str, Any]) -> dict[str, Any]:
    """Derive a JSON Schema + uiSchema for the form webview from the
    XSD subtree bound to a UI tree node. Payload-agnostic: keyed on
    the complex-type name (e.g. ``"Hlr"``, ``"Llr"``).
    """
    type_name = params.get("type")
    if not isinstance(type_name, str):
        raise ValueError("form_schema requires string 'type'")
    xsd_path = _as_path(params.get("xsd_path"), PROJECT_XSD)
    refs = params.get("refs")
    if refs is not None and not isinstance(refs, dict):
        raise ValueError("'refs' must be an object or null")
    return _derive_form_schema(
        type_name,
        xsd_path=xsd_path,
        refs=refs,
    )


def _method_next_free_id(params: dict[str, Any]) -> dict[str, Any]:
    """Allocate the next free ``HLR-NNN`` or ``LLR-XXX-NN`` id (HLR-005)."""
    kind = params.get("kind")
    if kind not in {"hlr", "llr"}:
        raise ValueError("next_free_id requires kind='hlr' or 'llr'")
    xml_path = _as_path(params.get("xml_path"), PROJECT_XML)
    if kind == "hlr":
        return {"id": _next_free_hlr_id(xml_path)}
    function = params.get("function")
    if not isinstance(function, str) or not function:
        raise ValueError("next_free_id kind='llr' requires 'function' prefix")
    return {"id": _next_free_llr_id(function, xml_path)}


METHODS: dict[str, Callable[[dict[str, Any]], Any]] = {
    "lint": _method_lint,
    "render": _method_render,
    "parse_to_json": _method_parse_to_json,
    "list_documents": _method_list_documents,
    "ui_hints_index": _method_ui_hints_index,
    "init_project": _method_init_project,
    "apply_edit": _method_apply_edit,
    "form_schema": _method_form_schema,
    "next_free_id": _method_next_free_id,
}


# --------------------------------------------------------------------- #
# Request dispatch                                                       #
# --------------------------------------------------------------------- #

def _make_error(req_id: Any, code: int, message: str) -> dict[str, Any]:
    return {
        "jsonrpc": "2.0",
        "id": req_id,
        "error": {"code": code, "message": message},
    }


def _make_result(req_id: Any, result: Any) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": req_id, "result": result}


def handle_request(request: Any) -> dict[str, Any] | None:
    """Dispatch a single decoded request object. Returns the response
    dict, or None if the request was a JSON-RPC notification (no id and
    explicit jsonrpc=="2.0").
    """
    if not isinstance(request, dict):
        return _make_error(None, INVALID_REQUEST,
                           "request must be a JSON object")

    req_id = request.get("id")
    is_notification = "id" not in request and request.get("jsonrpc") == "2.0"

    method = request.get("method")
    if not isinstance(method, str):
        if is_notification:
            return None
        return _make_error(req_id, INVALID_REQUEST,
                           "request is missing string 'method'")

    handler = METHODS.get(method)
    if handler is None:
        if is_notification:
            return None
        return _make_error(req_id, METHOD_NOT_FOUND,
                           f"method not found: {method}")

    params = request.get("params", {})
    if params is None:
        params = {}
    if not isinstance(params, dict):
        if is_notification:
            return None
        return _make_error(req_id, INVALID_PARAMS,
                           "'params' must be an object or omitted")

    try:
        result = handler(params)
    except ValueError as exc:
        if is_notification:
            return None
        return _make_error(req_id, INVALID_PARAMS, str(exc))
    except ProjectXmlError as exc:
        if is_notification:
            return None
        return _make_error(req_id, APPLICATION_ERROR, str(exc))
    except Exception as exc:  # pragma: no cover - defensive
        if is_notification:
            return None
        return _make_error(
            req_id, INTERNAL_ERROR,
            f"{type(exc).__name__}: {exc}",
        )

    if is_notification:
        return None
    return _make_result(req_id, result)


def serve(stdin=None, stdout=None) -> int:
    """Run the JSON-RPC loop until stdin is exhausted. Returns 0."""
    if stdin is None:
        stdin = sys.stdin
    if stdout is None:
        stdout = sys.stdout
    for raw in stdin:
        line = raw.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError as exc:
            response: dict[str, Any] | None = _make_error(
                None, PARSE_ERROR, f"invalid JSON: {exc}"
            )
        else:
            response = handle_request(request)
        if response is not None:
            stdout.write(json.dumps(response) + "\n")
            stdout.flush()
    return 0


def main() -> int:
    return serve()


if __name__ == "__main__":
    raise SystemExit(main())
