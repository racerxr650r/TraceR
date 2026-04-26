"""Per-intent translators: typed JSON response → JSON Patch (HLR-019, HLR-051).

Every authoring intent's pipeline call yields a typed JSON object whose
shape is pinned by the intent's JSON Schema in :mod:`tools.ai.schemas`.
The translator in this module turns that object into a list of operations
consumable by :func:`tools.project_edit.apply_edit`.

Translators are deterministic and never call out to the model: the LM
chooses the *content*; the translator chooses the *XPath*. ID allocation
re-uses :func:`tools.project_edit.next_free_hlr_id` /
:func:`tools.project_edit.next_free_llr_id` so the LM cannot collide
with existing rows.

The PVD ghostwriter intent (``draft.pvd``) does **not** route through
this module: it produces a Markdown diff, which the TS layer presents
in a side-by-side editor and writes via the same diff-preview gate as
``Project.xml`` edits but a separate applier.

Each translator returns either a list of operations or, for advisory
intents (``review.item``), an empty list — the response is surfaced as
chat output instead of as an edit.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping

from project_edit import (
    next_free_hlr_id as _next_free_hlr_id,
    next_free_llr_id as _next_free_llr_id,
)

from .registry import IntentSpec


class TranslatorError(ValueError):
    """Raised when a typed-JSON response is structurally fine against its
    schema but semantically incoherent (e.g. references an HLR section
    that does not exist). The pipeline surfaces this as a retry-prompt
    finding rather than crashing.
    """


# --------------------------------------------------------------------- #
# Helpers                                                                #
# --------------------------------------------------------------------- #

def _trace_list(traces: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """Normalise a list of {target, ref, name?} dicts into ``<trace>`` rows."""
    if not traces:
        return []
    out = []
    for t in traces:
        target = (t.get("target") or "").strip()
        ref = (t.get("ref") or "").strip()
        if not target or not ref:
            continue
        row: dict[str, Any] = {"@target": target, "@ref": ref}
        if t.get("name"):
            row["@name"] = t["name"]
        out.append(row)
    return out


def _hlr_section_path(section: str | None) -> str:
    if not section:
        section = "1"
    return f"/hlrs/section[number={section}]/hlr/-"


def _llr_function_path(function: str | None) -> str:
    if not function:
        raise TranslatorError("draft.llr requires target.section (the LLR function/prefix)")
    return f"/llrs/function[name={function}]/llr/-"


def _test_file_path(file_path: str | None) -> str:
    if not file_path:
        raise TranslatorError("draft.test requires target.file (the <file path=...>)")
    return f"/tests/file[path={file_path}]/test/-"


def _module_path() -> str:
    return "/sdd/modules/module/-"


# --------------------------------------------------------------------- #
# Authoring translators                                                  #
# --------------------------------------------------------------------- #

def translate_draft_hlr(
    response: Mapping[str, Any],
    *,
    target_section: str | None,
    xml_path: Path,
    **_: Any,
) -> list[dict[str, Any]]:
    """``draft.hlr`` response → one ``add`` op appending a new ``<hlr>`` to
    the named section. ID is allocated from the parsed tree, never trusted
    from the LM.
    """
    name = (response.get("name") or "").strip()
    text = (response.get("text") or "").strip()
    traces = _trace_list(response.get("traces") or [])
    if not name:
        raise TranslatorError("draft.hlr response missing required 'name'")
    if not text:
        raise TranslatorError("draft.hlr response missing required 'text'")
    new_id = _next_free_hlr_id(xml_path)
    value: dict[str, Any] = {"@id": new_id, "@name": name, "text": text}
    if traces:
        value["traces"] = {"trace": traces}
    return [{
        "op": "add",
        "path": _hlr_section_path(target_section),
        "value": value,
    }]


def translate_draft_llr(
    response: Mapping[str, Any],
    *,
    target_section: str | None,
    xml_path: Path,
    **_: Any,
) -> list[dict[str, Any]]:
    text = (response.get("text") or "").strip()
    traces = _trace_list(response.get("traces") or [])
    if not text:
        raise TranslatorError("draft.llr response missing required 'text'")
    if not target_section:
        raise TranslatorError("draft.llr requires target.section (LLR function prefix)")
    new_id = _next_free_llr_id(target_section, xml_path)
    value: dict[str, Any] = {"@id": new_id, "text": text}
    if traces:
        value["traces"] = {"trace": traces}
    return [{
        "op": "add",
        "path": _llr_function_path(target_section),
        "value": value,
    }]


def translate_draft_test(
    response: Mapping[str, Any],
    *,
    target_file: str | None,
    **_: Any,
) -> list[dict[str, Any]]:
    name = (response.get("name") or "").strip()
    purpose = (response.get("purpose") or "").strip()
    traces = _trace_list(response.get("traces") or [])
    if not name:
        raise TranslatorError("draft.test response missing required 'name'")
    if not purpose:
        raise TranslatorError("draft.test response missing required 'purpose'")
    value: dict[str, Any] = {"@name": name, "purpose": purpose}
    if traces:
        value["traces"] = {"trace": traces}
    return [{
        "op": "add",
        "path": _test_file_path(target_file),
        "value": value,
    }]


def translate_draft_module(
    response: Mapping[str, Any],
    **_: Any,
) -> list[dict[str, Any]]:
    path = (response.get("path") or "").strip()
    title = (response.get("title") or "").strip()
    purpose = (response.get("purpose") or "").strip()
    if not path:
        raise TranslatorError("draft.module response missing required 'path'")
    if not title:
        raise TranslatorError("draft.module response missing required 'title'")
    value: dict[str, Any] = {
        "@path": path,
        "@title": title,
    }
    if purpose:
        value["purpose"] = purpose
    responsibilities = response.get("responsibilities") or []
    if responsibilities:
        # `_populate_element` turns list-of-strings into one child per item.
        value["responsibility"] = [r for r in responsibilities if r]
    return [{
        "op": "add",
        "path": _module_path(),
        "value": value,
    }]


def translate_expand_hlr_to_llrs(
    response: Mapping[str, Any],
    *,
    target_id: str | None,
    target_section: str | None,
    xml_path: Path,
    **_: Any,
) -> list[dict[str, Any]]:
    """``expand.hlr_to_llrs`` returns ``{candidates: [{text, function?, traces?}, ...]}``.
    Translator emits one append per candidate to the named function. Trace
    pre-fill defaults to the source HLR.
    """
    if not target_id:
        raise TranslatorError("expand.hlr_to_llrs requires target.id (HLR-NNN)")
    candidates = response.get("candidates") or []
    if not candidates:
        raise TranslatorError("expand.hlr_to_llrs response has no candidates")
    ops: list[dict[str, Any]] = []
    for cand in candidates:
        text = (cand.get("text") or "").strip()
        if not text:
            continue
        function = (cand.get("function") or target_section or "").strip()
        if not function:
            raise TranslatorError(
                "expand.hlr_to_llrs candidate missing 'function' and no target.section"
            )
        new_id = _next_free_llr_id(function, xml_path)
        traces = _trace_list(cand.get("traces") or [{"target": "HLR", "ref": target_id}])
        ops.append({
            "op": "add",
            "path": _llr_function_path(function),
            "value": {
                "@id": new_id,
                "text": text,
                "traces": {"trace": traces},
            },
        })
    if not ops:
        raise TranslatorError("expand.hlr_to_llrs produced zero applicable candidates")
    return ops


def translate_expand_llr_to_tests(
    response: Mapping[str, Any],
    *,
    target_id: str | None,
    **_: Any,
) -> list[dict[str, Any]]:
    if not target_id:
        raise TranslatorError("expand.llr_to_tests requires target.id (LLR-XXX-NN)")
    candidates = response.get("candidates") or []
    if not candidates:
        raise TranslatorError("expand.llr_to_tests response has no candidates")
    ops: list[dict[str, Any]] = []
    for cand in candidates:
        name = (cand.get("name") or "").strip()
        purpose = (cand.get("purpose") or "").strip()
        file_path = (cand.get("file") or "").strip()
        if not name or not purpose or not file_path:
            continue
        traces = _trace_list(cand.get("traces") or [{"target": "LLR", "ref": target_id}])
        ops.append({
            "op": "add",
            "path": _test_file_path(file_path),
            "value": {
                "@name": name,
                "purpose": purpose,
                "traces": {"trace": traces},
            },
        })
    if not ops:
        raise TranslatorError("expand.llr_to_tests produced zero applicable candidates")
    return ops


def translate_suggest_traces(
    response: Mapping[str, Any],
    *,
    target_type: str,
    target_id: str | None,
    target_section: str | None,
    target_file: str | None,
    **_: Any,
) -> list[dict[str, Any]]:
    """``suggest.traces`` returns ``{traces: [{target, ref, name?}, …]}``.
    Translator emits a single ``replace`` op on the existing element's
    ``traces`` block. Caller is responsible for showing the diff.
    """
    traces = _trace_list(response.get("traces") or [])
    if not traces:
        raise TranslatorError("suggest.traces response has no traces")
    if target_type == "Hlr" and target_id and target_section:
        path = f"/hlrs/section[number={target_section}]/hlr[id={target_id}]/traces"
    elif target_type == "Llr" and target_id and target_section:
        path = f"/llrs/function[name={target_section}]/llr[id={target_id}]/traces"
    elif target_type == "Test" and target_id and target_file:
        path = f"/tests/file[path={target_file}]/test[name={target_id}]/traces"
    else:
        raise TranslatorError(
            f"suggest.traces needs (type={target_type}, id, section/file); "
            f"got id={target_id} section={target_section} file={target_file}"
        )
    return [{
        "op": "replace",
        "path": path,
        "value": {"trace": traces},
    }]


def translate_gap_fix(
    response: Mapping[str, Any],
    *,
    xml_path: Path,
    target_section: str | None,
    target_file: str | None,
    **_: Any,
) -> list[dict[str, Any]]:
    """``gap.fix`` returns either ``{kind: "llr", llr: {...}}`` or
    ``{kind: "test", test: {...}}``. Translator dispatches to the matching
    draft translator.
    """
    kind = response.get("kind")
    if kind == "llr":
        return translate_draft_llr(
            response.get("llr") or {},
            target_section=target_section,
            xml_path=xml_path,
        )
    if kind == "test":
        return translate_draft_test(
            response.get("test") or {},
            target_file=target_file,
        )
    raise TranslatorError(f"gap.fix response has unsupported kind: {kind!r}")


# --------------------------------------------------------------------- #
# Dispatch table                                                         #
# --------------------------------------------------------------------- #

# Intent id -> translator callable. Advisory intents (review.item) and
# the PVD ghostwriter (draft.pvd) are intentionally absent: the pipeline
# treats their responses as opaque payloads (text + structured findings)
# and never produces a JSON Patch.
TRANSLATORS = {
    "draft.hlr":            translate_draft_hlr,
    "draft.llr":            translate_draft_llr,
    "draft.test":           translate_draft_test,
    "draft.module":         translate_draft_module,
    "expand.hlr_to_llrs":   translate_expand_hlr_to_llrs,
    "expand.llr_to_tests":  translate_expand_llr_to_tests,
    "suggest.traces":       translate_suggest_traces,
    "gap.fix":              translate_gap_fix,
}


def has_translator(intent: IntentSpec) -> bool:
    return intent.id in TRANSLATORS


def translate(
    intent: IntentSpec,
    response: Mapping[str, Any],
    *,
    xml_path: Path,
    target_type: str,
    target_id: str | None = None,
    target_section: str | None = None,
    target_file: str | None = None,
) -> list[dict[str, Any]]:
    """Dispatch to the per-intent translator. Returns the list of
    JSON Patch operations the pipeline should hand to ``apply_edit``.
    """
    fn = TRANSLATORS.get(intent.id)
    if fn is None:
        raise TranslatorError(f"intent {intent.id!r} has no JSON Patch translator")
    return fn(
        response,
        xml_path=xml_path,
        target_type=target_type,
        target_id=target_id,
        target_section=target_section,
        target_file=target_file,
    )
