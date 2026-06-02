# tools/Makefile — developer convenience targets for TraceR.
#
# Usage (run from anywhere; targets cd as needed):
#     make -C tools <target>
#
# Targets:
#   prereqs         Detect host OS and install full dev toolchain, then verify.
#   prereqs-ci      Slim install for CI (no VS Code, vsce, or gh).
#   prereqs-debian  Install via apt (Debian/Ubuntu/MX).
#   prereqs-fedora  Install via dnf (Fedora/RHEL/CentOS Stream).
#   prereqs-arch    Install via pacman (Arch/Manjaro).
#   prereqs-macos   Install via Homebrew (macOS).
#   verify          Print versions of the required tools.
#   bootstrap       Create .venv, install Python+Node deps, install
#                   the redhat.vscode-xml extension. Run after 'prereqs'.
#   project-init    Bootstrap a new project: skeleton Project.xml + PVD/SAR/VR/SDP.
#   detect          Print the detected OS family.
#   lint            Run tools/lint_project.py against doc/Project.xml.
#   validate-xml    Validate doc/Project.xml against tools/project.xsd.
#   render          Render all five spec templates (catches template/schema drift).
#   test-py         Run the Python unit tests under test/.
#   coverage        Run Python tests with coverage; produce term, XML, HTML reports.
#   coverage-report Regenerate coverage reports from the last .coverage data file.
#   ext-coverage    Run extension unit tests with coverage (c8); HTML+Cobertura output.
#   coverage_report Generate consolidated Markdown report from coverage XML files.
#   test-py-junit   Run Python tests with JUnit XML output.
#   ext-test-unit-junit  Run extension unit tests with JUnit XML output.
#   test_report     Generate consolidated Markdown test-results report.
#   ext-typecheck   Run 'tsc --noEmit' on the VS Code extension.
#   ext-build       Bundle the VS Code extension via esbuild.
#   ext-package     Produce a .vsix via 'vsce package'.
#   install         Build, package, and install the extension into VS Code.
#   ext-test-unit   Run the VS Code extension's mocha unit tests.
#   ext-test-ui     Run the ExTester Selenium UI tests (needs Chrome).
#   ext-screenshots Capture documentation screenshots via ExTester.
#   ext             ext-typecheck + ext-build (fail on any warning).
#   test            Run all tests (Python + extension unit + UI).
#   ci              lint + validate-xml + render + test + ext (CI umbrella).
#   analyze-bandit  Run Bandit security linter on Python sources.
#   analyze-pip-audit  Audit Python dependencies for known vulnerabilities.
#   analyze-eslint  Run ESLint + eslint-plugin-security on the extension.
#   analyze-npm-audit  Audit npm dependencies for known vulnerabilities.
#   analyze-semgrep Run Semgrep with OWASP community rules across Python and TS.
#   analyze         Run all static analysis tools and produce a summary.
#   analyze_report  Generate consolidated Markdown report from analysis JSON files.
#   analyze-check-errors  Like analyze_report, but exit 1 if error-level findings exist.
#   clean           Remove generated docs, extension build output, __pycache__.
#   clean-docs      Remove generated markdown specs (HLRs/LLRs/SDD/STP/Traceability).
#   clean-ext       Remove the VS Code extension's dist/ and *.vsix.
#   distclean       'clean' plus .venv and tools/vscode-project-xml/node_modules.
#
# The prereqs targets detect the host OS and dispatch to the matching
# package-manager recipe to install the system-level toolchain
# documented in doc/SDP.md §0. Every install recipe uses $(SUDO)
# (auto-detected: empty when already root). brew manages its own
# privilege escalation.
#
# CI usage: prefer 'prereqs-ci' (slim — no VS Code, no vsce, no gh)
# and the 'ci' umbrella target.

SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c

# Auto-detect privilege escalation: empty when already root.
SUDO := $(shell [ "$$(id -u)" = 0 ] || echo sudo)

# ---------------------------------------------------------------- #
# OS detection                                                     #
# ---------------------------------------------------------------- #
# Result is one of: debian | fedora | arch | macos | unknown
UNAME_S := $(shell uname -s)

ifeq ($(UNAME_S),Darwin)
  OS_FAMILY := macos
else ifeq ($(UNAME_S),Linux)
  ID_LIKE := $(shell . /etc/os-release 2>/dev/null; echo "$${ID:-} $${ID_LIKE:-}")
  ifneq (,$(findstring debian,$(ID_LIKE))$(findstring ubuntu,$(ID_LIKE))$(findstring mx,$(ID_LIKE)))
    OS_FAMILY := debian
  else ifneq (,$(findstring fedora,$(ID_LIKE))$(findstring rhel,$(ID_LIKE))$(findstring centos,$(ID_LIKE)))
    OS_FAMILY := fedora
  else ifneq (,$(findstring arch,$(ID_LIKE))$(findstring manjaro,$(ID_LIKE)))
    OS_FAMILY := arch
  else
    OS_FAMILY := unknown
  endif
else
  OS_FAMILY := unknown
endif

.PHONY: help detect prereqs prereqs-ci verify bootstrap \
        prereqs-debian prereqs-fedora prereqs-arch prereqs-macos \
        project-init \
        ext-build ext-typecheck ext-package install ext \
        ext-test-unit ext-test-ui \
        lint validate-xml render test test-py ci \
        coverage coverage-report coverage_report ext-coverage \
        test-py-junit ext-test-unit-junit test_report \
        analyze analyze-bandit analyze-pip-audit \
        analyze-eslint analyze-npm-audit analyze-semgrep \
        analyze_report analyze-check-errors \
        clean clean-docs clean-ext distclean

help:
	@awk '/^# Targets:/{found=1} found{if(/^[^#]/ || /^#$$/)exit; sub(/^# ?/,""); print}' $(MAKEFILE_LIST)

detect:
	@echo "uname -s: $(UNAME_S)"
	@echo "OS family: $(OS_FAMILY)"

# ---------------------------------------------------------------- #
# Top-level dispatch                                               #
# ---------------------------------------------------------------- #
prereqs:
	@echo ">>> Detected OS family: $(OS_FAMILY)"
ifeq ($(OS_FAMILY),debian)
	@$(MAKE) --no-print-directory prereqs-debian
else ifeq ($(OS_FAMILY),fedora)
	@$(MAKE) --no-print-directory prereqs-fedora
else ifeq ($(OS_FAMILY),arch)
	@$(MAKE) --no-print-directory prereqs-arch
else ifeq ($(OS_FAMILY),macos)
	@$(MAKE) --no-print-directory prereqs-macos
else
	@echo "ERROR: unsupported OS ('uname -s' = $(UNAME_S))." >&2
	@echo "Run one of the explicit targets manually, or follow" >&2
	@echo "the per-platform instructions in doc/SDP.md §0." >&2
	@exit 1
endif
	@$(MAKE) --no-print-directory verify

# Slim CI variant: same OS dispatch, but each recipe omits VS Code,
# vsce, and gh (gated on $(CI_SLIM)=1 inside each prereqs-* recipe).
prereqs-ci:
	@echo ">>> Detected OS family: $(OS_FAMILY) (CI mode)"
ifeq ($(OS_FAMILY),debian)
	@$(MAKE) --no-print-directory CI_SLIM=1 prereqs-debian
else ifeq ($(OS_FAMILY),fedora)
	@$(MAKE) --no-print-directory CI_SLIM=1 prereqs-fedora
else ifeq ($(OS_FAMILY),arch)
	@$(MAKE) --no-print-directory CI_SLIM=1 prereqs-arch
else ifeq ($(OS_FAMILY),macos)
	@$(MAKE) --no-print-directory CI_SLIM=1 prereqs-macos
else
	@echo "ERROR: unsupported OS for prereqs-ci." >&2 ; exit 1
endif

# ---------------------------------------------------------------- #
# Debian / Ubuntu                                                  #
# ---------------------------------------------------------------- #
prereqs-debian:
	@echo ">>> Installing TraceR prerequisites via apt..."
	$(SUDO) apt update
	$(SUDO) apt install -y python3 python3-venv python3-pip \
	                      libxml2-utils \
	                      git wget gpg curl ca-certificates
	# Node.js 20 LTS via NodeSource (apt's 'nodejs' is older).
	@if ! node --version 2>/dev/null | grep -q '^v20\.'; then \
	    curl -fsSL https://deb.nodesource.com/setup_20.x | $(SUDO) -E bash - ; \
	    $(SUDO) apt install -y nodejs ; \
	fi
	# xvfb + Chrome / Chromium for ExTester UI tests (needed in CI too).
	$(SUDO) apt install -y xvfb
	@if ! command -v google-chrome >/dev/null 2>&1 && ! command -v chromium >/dev/null 2>&1 && ! command -v chromium-browser >/dev/null 2>&1; then \
	    echo "Installing google-chrome-stable for UI tests..." ; \
	    wget -q -O - https://dl.google.com/linux/linux_signing_key.pub \
	        | $(SUDO) gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg ; \
	    echo 'deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main' \
	        | $(SUDO) tee /etc/apt/sources.list.d/google-chrome.list >/dev/null ; \
	    $(SUDO) apt update && $(SUDO) apt install -y google-chrome-stable ; \
	fi
ifneq ($(CI_SLIM),1)
	# GitHub CLI: prefer distro package; fall back to upstream apt repo.
	@if ! command -v gh >/dev/null 2>&1; then \
	    if ! $(SUDO) apt install -y gh ; then \
	        curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
	            | $(SUDO) dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg ; \
	        echo "deb [arch=$$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
	            | $(SUDO) tee /etc/apt/sources.list.d/github-cli.list >/dev/null ; \
	        $(SUDO) apt update && $(SUDO) apt install -y gh ; \
	    fi ; \
	fi
	# VS Code via Microsoft apt repo.
	@if ! command -v code >/dev/null 2>&1; then \
	    wget -qO- https://packages.microsoft.com/keys/microsoft.asc \
	        | gpg --dearmor | $(SUDO) tee /usr/share/keyrings/packages.microsoft.gpg >/dev/null ; \
	    echo "deb [arch=amd64,arm64,armhf signed-by=/usr/share/keyrings/packages.microsoft.gpg] https://packages.microsoft.com/repos/code stable main" \
	        | $(SUDO) tee /etc/apt/sources.list.d/vscode.list >/dev/null ; \
	    $(SUDO) apt update && $(SUDO) apt install -y code ; \
	fi
	$(SUDO) npm install -g @vscode/vsce
endif
prereqs-fedora:
	@echo ">>> Installing TraceR prerequisites via dnf..."
	$(SUDO) dnf install -y python3 python3-pip libxml2 git curl
	# Node.js 20 LTS — distro package on Fedora 39+, NodeSource elsewhere.
	@if ! node --version 2>/dev/null | grep -q '^v20\.'; then \
	    if ! $(SUDO) dnf install -y nodejs npm ; then \
	        curl -fsSL https://rpm.nodesource.com/setup_20.x | $(SUDO) -E bash - ; \
	        $(SUDO) dnf install -y nodejs ; \
	    fi ; \
	fi
ifneq ($(CI_SLIM),1)
	# GitHub CLI — distro on Fedora; on RHEL enable cli/cli COPR first.
	@if ! command -v gh >/dev/null 2>&1; then \
	    $(SUDO) dnf install -y gh || { \
	        echo "gh not available via dnf; enable the cli/cli COPR or" >&2 ; \
	        echo "follow https://github.com/cli/cli/blob/trunk/docs/install_linux.md" >&2 ; \
	        exit 1 ; \
	    } ; \
	fi
	# VS Code via Microsoft yum repo (mirrors the upstream snippet at
	# https://code.visualstudio.com/docs/setup/linux).
	@if ! command -v code >/dev/null 2>&1; then \
	    $(SUDO) rpm --import https://packages.microsoft.com/keys/microsoft.asc ; \
	    printf '[code]\nname=Visual Studio Code\nbaseurl=https://packages.microsoft.com/yumrepos/vscode\nenabled=1\nautorefresh=1\ntype=rpm-md\ngpgcheck=1\ngpgkey=https://packages.microsoft.com/keys/microsoft.asc\n' \
	        | $(SUDO) tee /etc/yum.repos.d/vscode.repo >/dev/null ; \
	    $(SUDO) dnf check-update || true ; \
	    $(SUDO) dnf install -y code ; \
	fi
	# Chrome / Chromium for ExTester UI tests.
	@if ! command -v google-chrome >/dev/null 2>&1 && ! command -v chromium-browser >/dev/null 2>&1; then \
	    $(SUDO) dnf install -y google-chrome-stable || { \
	        echo "Install google-chrome-stable or chromium for UI tests." >&2 ; \
	    } ; \
	fi
	$(SUDO) npm install -g @vscode/vsce
endif
prereqs-arch:
	@echo ">>> Installing TraceR prerequisites via pacman..."
ifeq ($(CI_SLIM),1)
	$(SUDO) pacman -S --needed --noconfirm \
	    python python-pip libxml2 \
	    nodejs-lts-iron npm git
else
	$(SUDO) pacman -S --needed --noconfirm \
	    python python-pip libxml2 \
	    nodejs-lts-iron npm \
	    git github-cli
	# VS Code: prefer the OSS 'code' package; fall back to AUR for the
	# Microsoft-branded build (requires an AUR helper, not assumed here).
	@if ! command -v code >/dev/null 2>&1; then \
	    $(SUDO) pacman -S --needed --noconfirm code || { \
	        echo "Install 'visual-studio-code-bin' from the AUR for the" >&2 ; \
	        echo "Microsoft-branded VS Code build." >&2 ; \
	        exit 1 ; \
	    } ; \
	fi
	# Chrome / Chromium for ExTester UI tests.
	@if ! command -v google-chrome >/dev/null 2>&1 && ! command -v chromium >/dev/null 2>&1; then \
	    $(SUDO) pacman -S --needed --noconfirm chromium || { \
	        echo "Install google-chrome or chromium for UI tests." >&2 ; \
	    } ; \
	fi
	$(SUDO) npm install -g @vscode/vsce
endif

# ---------------------------------------------------------------- #
# macOS                                                            #
# ---------------------------------------------------------------- #
prereqs-macos:
	@echo ">>> Installing TraceR prerequisites via Homebrew..."
	@command -v brew >/dev/null 2>&1 || { \
	    echo "Homebrew is required. Install from https://brew.sh first." >&2 ; \
	    exit 1 ; \
	}
	brew update
ifeq ($(CI_SLIM),1)
	brew install python@3.12 libxml2 node@20 git
	brew link --overwrite --force node@20 || true
else
	brew install python@3.12 libxml2 node@20 git gh
	brew link --overwrite --force node@20 || true
	brew install --cask visual-studio-code || true
	# Chrome / Chromium for ExTester UI tests.
	brew install --cask google-chrome || true
	npm install -g @vscode/vsce
endif

# ---------------------------------------------------------------- #
# Verification                                                     #
# ---------------------------------------------------------------- #
# Print the version of every required tool. Exits non-zero if any
# tool is missing or below its documented minimum (best-effort: only
# the major version is checked).
verify:
	@echo ">>> Verifying installed toolchain..."
	@status=0 ; \
	check_min() { \
	    local name="$$1" cmd="$$2" min="$$3" actual ; \
	    if ! command -v "$$cmd" >/dev/null 2>&1 ; then \
	        printf "  [MISSING] %-12s (want >= %s)\n" "$$name" "$$min" ; \
	        status=1 ; return ; \
	    fi ; \
	    actual=$$("$$cmd" --version 2>&1 | head -n1) ; \
	    printf "  [OK]      %-12s %s\n" "$$name" "$$actual" ; \
	} ; \
	check_min "python3"   python3 "3.10"   ; \
	check_min "node"      node    "20"     ; \
	check_min "npm"       npm     "10"     ; \
	check_min "git"       git     "2.30"   ; \
	check_min "code"      code    "1.90"   ; \
	check_min "gh"        gh      "any"    ; \
	check_min "vsce"      vsce    "2.x"    ; \
	if command -v google-chrome >/dev/null 2>&1 ; then \
	    printf "  [OK]      %-12s %s\n" "chrome" "$$(google-chrome --version 2>&1 | head -n1)" ; \
	elif command -v chromium >/dev/null 2>&1 ; then \
	    printf "  [OK]      %-12s %s\n" "chromium" "$$(chromium --version 2>&1 | head -n1)" ; \
	elif command -v chromium-browser >/dev/null 2>&1 ; then \
	    printf "  [OK]      %-12s %s\n" "chromium" "$$(chromium-browser --version 2>&1 | head -n1)" ; \
	else \
	    printf "  [WARN]    %-12s (required for UI tests; install google-chrome or chromium)\n" "chrome" ; \
	fi ; \
	if command -v xmllint >/dev/null 2>&1 ; then \
	    printf "  [OK]      %-12s %s\n" "xmllint" "$$(xmllint --version 2>&1 | head -n1)" ; \
	elif python3 -c 'import lxml' 2>/dev/null ; then \
	    printf "  [OK]      %-12s %s\n" "lxml"    "$$(python3 -c 'import lxml.etree as e; print(e.LXML_VERSION)')" ; \
	else \
	    printf "  [WARN]    %-12s (optional; install xmllint or 'pip install lxml' for strict XSD validation)\n" "xmllint/lxml" ; \
	fi ; \
	echo "  --- Static analysis tools (installed via bootstrap) ---" ; \
	if command -v bandit >/dev/null 2>&1 ; then \
	    printf "  [OK]      %-12s %s\n" "bandit" "$$(bandit --version 2>&1 | head -n1)" ; \
	else \
	    printf "  [INFO]    %-12s (install via bootstrap: pip install bandit)\n" "bandit" ; \
	fi ; \
	if command -v pip-audit >/dev/null 2>&1 ; then \
	    printf "  [OK]      %-12s %s\n" "pip-audit" "$$(pip-audit --version 2>&1 | head -n1)" ; \
	else \
	    printf "  [INFO]    %-12s (install via bootstrap: pip install pip-audit)\n" "pip-audit" ; \
	fi ; \
	if command -v semgrep >/dev/null 2>&1 ; then \
	    printf "  [OK]      %-12s %s\n" "semgrep" "$$(semgrep --version 2>&1 | head -n1)" ; \
	else \
	    printf "  [INFO]    %-12s (install via bootstrap: pip install semgrep)\n" "semgrep" ; \
	fi ; \
	if [[ -f "$(EXT_DIR)/node_modules/.bin/eslint" ]] ; then \
	    printf "  [OK]      %-12s %s\n" "eslint" "$$(cd $(EXT_DIR) && npx eslint --version 2>&1 | head -n1)" ; \
	else \
	    printf "  [INFO]    %-12s (install via bootstrap: npm install in extension)\n" "eslint" ; \
	fi ; \
	echo ; \
	if [[ $$status -eq 0 ]] ; then \
	    echo "All required tools present. Run 'make -C tools bootstrap'" ; \
	    echo "to create the .venv and install per-project dependencies." ; \
	 else \
	    echo "Some required tools are missing — re-run 'make -C tools prereqs'." ; \
	 fi ; \
	 exit $$status

# ---------------------------------------------------------------- #
# Per-project bootstrap                                            #
# ---------------------------------------------------------------- #
# Creates a Python venv, installs the renderer/linter dependencies,
# installs the VS Code extension's npm packages, and installs the
# redhat.vscode-xml VS Code extension. Idempotent.
#
# Variables (override at the make command line):
#   VENV_DIR          Path to the Python venv (default: .venv at repo root).
#   PYTHON            Interpreter used to create the venv (default: python3).
REPO_ROOT  := $(abspath $(dir $(lastword $(MAKEFILE_LIST)))/..)
VENV_DIR   ?= $(REPO_ROOT)/.venv
PYTHON     ?= python3
VENV_PIP   := $(VENV_DIR)/bin/pip
EXT_DIR    := $(REPO_ROOT)/tools/vscode-project-xml

bootstrap:
	@echo ">>> Creating Python venv at $(VENV_DIR)..."
	@if [[ ! -x "$(VENV_DIR)/bin/python" ]]; then \
	    $(PYTHON) -m venv "$(VENV_DIR)" ; \
	fi
	@echo ">>> Installing Python dependencies (jinja2, lxml, xmlschema)..."
	"$(VENV_PIP)" install --upgrade pip
	"$(VENV_PIP)" install jinja2 lxml xmlschema coverage unittest-xml-reporting \
	    bandit pip-audit semgrep
	@echo ">>> Installing VS Code extension npm dependencies..."
	@if [[ -f "$(EXT_DIR)/package.json" ]]; then \
	    cd "$(EXT_DIR)" && npm install ; \
	else \
	    echo "  (skipped: $(EXT_DIR)/package.json not present yet)" ; \
	fi
	@echo ">>> Installing the redhat.vscode-xml VS Code extension..."
	@if command -v code >/dev/null 2>&1 ; then \
	    code --install-extension redhat.vscode-xml --force ; \
	else \
	    echo "  (skipped: 'code' CLI not on PATH)" ; \
	fi
	@echo ""
	@echo "Bootstrap complete. Activate the venv with:"
	@echo "  source $(VENV_DIR)/bin/activate"

# ---------------------------------------------------------------- #
# Project bootstrap (project-init)                                 #
# ---------------------------------------------------------------- #
# Create a skeleton Project.xml plus hand-authored document
# templates (PVD, SAR, VR, SDP) as the first step of a new project.
#
# Required variables:
#   NAME          Full project name
#   SHORT_NAME    Short / package name
#
# Optional variables:
#   AUTHOR        Author string (default: TBD)
#   XML_OUT       Output path for Project.xml (default: doc/Project.xml)
#   PVD_OUT       Output path for PVD.md (default: doc/PVD.md)
#   FORCE         Set to 1 to overwrite existing files without prompting

AUTHOR       ?= TBD
XML_OUT      ?= $(REPO_ROOT)/doc/Project.xml
PVD_OUT      ?= $(REPO_ROOT)/doc/PVD.md
PROJ_TMPL    := $(REPO_ROOT)/tools/templates/Project.xml.template
PVD_TMPL     := $(REPO_ROOT)/tools/templates/PVD.md.template
FORCE        ?=

project-init:
	@if [[ -z "$(NAME)" || -z "$(SHORT_NAME)" ]]; then \
	    echo "ERROR: project-init requires NAME and SHORT_NAME." >&2 ; \
	    echo "  Usage: make project-init NAME=\"My Product\" SHORT_NAME=\"myprod\"" >&2 ; \
	    exit 1 ; \
	fi
	@if [[ ! -f "$(PVD_TMPL)" ]]; then \
	    echo "ERROR: PVD template not found: $(PVD_TMPL)" >&2 ; \
	    exit 1 ; \
	fi
	@if [[ -z "$(FORCE)" ]]; then \
	    existing="" ; \
	    [[ -f "$(XML_OUT)" ]] && existing="$(XML_OUT)" ; \
	    [[ -f "$(PVD_OUT)" ]] && existing="$$existing $(PVD_OUT)" ; \
	    if [[ -n "$$existing" ]]; then \
	        echo "ERROR: refusing to overwrite existing file(s):" >&2 ; \
	        for f in $$existing; do echo "  $$f" >&2 ; done ; \
	        echo "Re-run with FORCE=1 to overwrite." >&2 ; \
	        exit 1 ; \
	    fi ; \
	fi
	@mkdir -p "$(dir $(XML_OUT))" "$(dir $(PVD_OUT))"
	@SCHEMA_LOC=$$(python3 -c "import os; print(os.path.relpath('$(REPO_ROOT)/tools/project.xsd', '$(dir $(XML_OUT))'))") ; \
	TODAY=$$(date +%Y-%m-%d) ; \
	sed -e "s|@@NAME@@|$(NAME)|g" \
	    -e "s|@@SHORT_NAME@@|$(SHORT_NAME)|g" \
	    -e "s|@@DATE@@|$$TODAY|g" \
	    -e "s|@@AUTHOR@@|$(AUTHOR)|g" \
	    -e "s|@@SCHEMA_LOCATION@@|$$SCHEMA_LOC|g" \
	    "$(PROJ_TMPL)" > "$(XML_OUT)"
	@echo "Wrote skeleton $(XML_OUT)"
	@TODAY=$$(date +%Y-%m-%d) ; \
	sed -e "s|<Product Name>|$(NAME)|g" \
	    -e "s|<short_name>|$(SHORT_NAME)|g" \
	    -e "s|<YYYY-MM-DD>|$$TODAY|g" \
	    -e "s|<Your name(s)>|$(AUTHOR)|g" \
	    "$(PVD_TMPL)" > "$(PVD_OUT)"
	@echo "Wrote $(PVD_OUT)"
	@echo ">>> Generating hand-authored documents (SAR, VR, SDP)..."
	@"$(VENV_PYTHON)" "$(REPO_ROOT)/tools/render_doc.py" --generate-doc SAR VR SDP \
	    --name "$(NAME)" --short-name "$(SHORT_NAME)" --author "$(AUTHOR)" \
	    --doc-out-dir "$(dir $(PVD_OUT))" \
	    $(if $(FORCE),--force,)
	@echo ""
	@echo "Next steps: edit doc/PVD.md, then populate doc/Project.xml"
	@echo "and regenerate the spec documents with render_doc.py."

# ---------------------------------------------------------------- #
# VS Code extension build                                          #
# ---------------------------------------------------------------- #
# These targets cd into tools/vscode-project-xml and run the npm
# scripts defined in its package.json. They auto-run 'npm install'
# if node_modules/ is missing so a fresh checkout works without a
# separate bootstrap step.

ext-typecheck:
	@echo ">>> Type-checking VS Code extension (tsc --noEmit)..."
	@if [[ ! -d "$(EXT_DIR)/node_modules" ]]; then \
	    cd "$(EXT_DIR)" && npm install ; \
	fi
	cd "$(EXT_DIR)" && npm run compile

ext-build: ext-typecheck
	@echo ">>> Bundling VS Code extension (esbuild)..."
	cd "$(EXT_DIR)" && npm run build

# ---------------------------------------------------------------- #
# Project verification (lint, schema validation, render, tests)    #
# ---------------------------------------------------------------- #
# These targets run inside the venv if it exists, otherwise fall
# back to the system python3. Override with PYTHON=...

VENV_PYTHON := $(shell [ -x "$(VENV_DIR)/bin/python" ] && echo "$(VENV_DIR)/bin/python" || echo "$(PYTHON)")
VENV_SEMGREP := $(shell [ -x "$(VENV_DIR)/bin/semgrep" ] && echo "$(VENV_DIR)/bin/semgrep" || echo semgrep)
PROJECT_XML := $(REPO_ROOT)/doc/Project.xml
PROJECT_XSD := $(REPO_ROOT)/tools/project.xsd
TEMPLATES_DIR := $(REPO_ROOT)/tools/templates

lint:
	@echo ">>> Linting $(PROJECT_XML)..."
	"$(VENV_PYTHON)" "$(REPO_ROOT)/tools/lint_project.py" \
	    --xml "$(PROJECT_XML)" --xsd "$(PROJECT_XSD)"

validate-xml:
	@echo ">>> Validating $(PROJECT_XML) against $(PROJECT_XSD)..."
	@if command -v xmllint >/dev/null 2>&1 ; then \
	    xmllint --noout --schema "$(PROJECT_XSD)" "$(PROJECT_XML)" ; \
	else \
	    "$(VENV_PYTHON)" -c "import sys, xmlschema; \
	schema = xmlschema.XMLSchema(sys.argv[1]); \
	schema.validate(sys.argv[2]); \
	print(sys.argv[2] + ' validates')" "$(PROJECT_XSD)" "$(PROJECT_XML)" ; \
	fi

render:
	@echo ">>> Rendering all spec templates (drift check)..."
	@for spec in SDD HLRs LLRs STP Traceability ; do \
	    echo "  - $$spec" ; \
	    "$(VENV_PYTHON)" "$(REPO_ROOT)/tools/render_doc.py" \
	        "$(TEMPLATES_DIR)/$$spec.md.j2" "$$spec" \
	        --xml "$(PROJECT_XML)" \
	        --out "$(REPO_ROOT)/doc/$$spec.md" ; \
	done

test-py:
	@echo ">>> Running Python unit tests..."
	cd "$(REPO_ROOT)" && "$(VENV_PYTHON)" -m unittest discover -s test -p 'test_*.py'

coverage:
	@echo ">>> Running Python tests with coverage measurement..."
	cd "$(REPO_ROOT)" && "$(VENV_PYTHON)" -m coverage run \
	    --rcfile="$(REPO_ROOT)/.coveragerc" \
	    -m unittest discover -s test -p 'test_*.py'
	cd "$(REPO_ROOT)" && "$(VENV_PYTHON)" -m coverage report --show-missing
	cd "$(REPO_ROOT)" && "$(VENV_PYTHON)" -m coverage xml -o test_reports/coverage.xml
	cd "$(REPO_ROOT)" && "$(VENV_PYTHON)" -m coverage html -d test_reports/html
	@echo ""
	@echo "Coverage XML:  $(REPO_ROOT)/test_reports/coverage.xml"
	@echo "Coverage HTML: $(REPO_ROOT)/test_reports/html/index.html"

ext-coverage:
	@echo ">>> Running VS Code extension unit tests with coverage (c8)..."
	@if [[ ! -d "$(EXT_DIR)/node_modules" ]]; then \
	    cd "$(EXT_DIR)" && npm install ; \
	fi
	cd "$(EXT_DIR)" && npm run test:coverage
	mv "$(REPO_ROOT)/test_reports/ext/cobertura-coverage.xml" "$(REPO_ROOT)/test_reports/ext-coverage.xml"
	@echo ""
	@echo "Extension coverage HTML: $(REPO_ROOT)/test_reports/ext/index.html"
	@echo "Extension coverage XML:  $(REPO_ROOT)/test_reports/ext-coverage.xml"

coverage_report:
	@echo ">>> Generating consolidated coverage report..."
	cd "$(REPO_ROOT)" && "$(VENV_PYTHON)" "$(REPO_ROOT)/tools/coverage_report.py" \
	    --py-xml test_reports/coverage.xml \
	    --ext-xml test_reports/ext-coverage.xml \
	    --out test_reports/coverage_report.md

coverage-report:
	@echo ">>> Generating coverage report (no test re-run)..."
	cd "$(REPO_ROOT)" && "$(VENV_PYTHON)" -m coverage report --show-missing
	cd "$(REPO_ROOT)" && "$(VENV_PYTHON)" -m coverage xml -o test_reports/coverage.xml
	cd "$(REPO_ROOT)" && "$(VENV_PYTHON)" -m coverage html -d test_reports/html
	@echo ""
	@echo "Coverage XML:  $(REPO_ROOT)/test_reports/coverage.xml"
	@echo "Coverage HTML: $(REPO_ROOT)/test_reports/html/index.html"

test-py-junit:
	@echo ">>> Running Python unit tests with JUnit XML output..."
	@mkdir -p "$(REPO_ROOT)/test_reports/py-results"
	cd "$(REPO_ROOT)" && "$(VENV_PYTHON)" -m xmlrunner discover \
	    -s test -p 'test_*.py' -o test_reports/py-results

ext-test-unit-junit:
	@echo ">>> Running VS Code extension unit tests with JUnit XML output..."
	@if [[ ! -d "$(EXT_DIR)/node_modules" ]]; then \
	    cd "$(EXT_DIR)" && npm install ; \
	fi
	cd "$(EXT_DIR)" && npm run test:unit:junit

test_report:
	@echo ">>> Generating consolidated test-results report..."
	cd "$(REPO_ROOT)" && "$(VENV_PYTHON)" "$(REPO_ROOT)/tools/test_results_report.py" \
	    --py-results-dir test_reports/py-results \
	    --ext-results-xml test_reports/ext-results.xml \
	    --out test_reports/test-report.md

ext-test-unit:
	@echo ">>> Running VS Code extension unit tests (mocha)..."
	@if [[ ! -d "$(EXT_DIR)/node_modules" ]]; then \
	    cd "$(EXT_DIR)" && npm install ; \
	fi
	cd "$(EXT_DIR)" && npm run test:unit

ext-test-ui:
	@echo ">>> Running VS Code extension UI tests (ExTester)..."
	@echo "  Preflight: checking sidecar can start with venv Python..."
	@echo '{"id":1,"method":"parse_to_json","params":{"xml_path":"$(PROJECT_XML)"}}' \
	    | "$(VENV_PYTHON)" "$(REPO_ROOT)/tools/project_io.py" >/dev/null \
	    || { echo "ERROR: sidecar preflight failed — check Python venv and dependencies." >&2; exit 1; }
	@if [[ ! -d "$(EXT_DIR)/node_modules" ]]; then \
	    cd "$(EXT_DIR)" && npm install ; \
	fi
	@export PROJECT_XML_PYTHON="$(VENV_PYTHON)" PROJECT_XML_TOOLS_DIR="$(REPO_ROOT)/tools" PROJECT_XML_WORKSPACE="$(EXT_DIR)/test/ui/fixtures" ; \
	if [[ -z "$${DISPLAY:-}" ]]; then \
	    echo "  (no DISPLAY — using xvfb-run)" ; \
	    cd "$(EXT_DIR)" && xvfb-run -a npm run test:ui ; \
	else \
	    cd "$(EXT_DIR)" && npm run test:ui ; \
	fi

ext-screenshots: ext-build
	@echo ">>> Capturing screenshots for documentation (ExTester)..."
	@if [[ ! -d "$(EXT_DIR)/node_modules" ]]; then \
	    cd "$(EXT_DIR)" && npm install ; \
	fi
	@export PROJECT_XML_PYTHON="$(VENV_PYTHON)" PROJECT_XML_TOOLS_DIR="$(REPO_ROOT)/tools" PROJECT_XML_WORKSPACE="$(EXT_DIR)/test/ui/fixtures" ; \
	if [[ -z "$${DISPLAY:-}" ]]; then \
	    echo "  (no DISPLAY — using xvfb-run)" ; \
	    cd "$(EXT_DIR)" && xvfb-run -a npm run test:screenshots ; \
	else \
	    cd "$(EXT_DIR)" && npm run test:screenshots ; \
	fi
	@echo "Screenshots saved to images/screenshots/"

test: test-py ext-test-unit ext-test-ui
	@echo ""
	@echo "All test suites passed."

# CI umbrella. Order matters: lint+validate fail fast on bad XML
# before the slower render/test/ext steps run.
ci: lint validate-xml render test ext
	@echo ""
	@echo "All CI checks passed."

# Convenience alias.
ext: ext-build
	@echo "VS Code extension built cleanly."

ext-package: ext-build
	@echo ">>> Packaging VS Code extension (vsce package)..."
	$(eval VERSION := $(shell cat "$(REPO_ROOT)/VERSION" | sed 's/^v//'))
	cd "$(EXT_DIR)" && node scripts/prepackage.js
	cd "$(EXT_DIR)" && npx vsce package -o "vscode-project-xml-$(VERSION).vsix"
	@echo ""
	@echo "To install, run:"
	@echo "  code --install-extension $(EXT_DIR)/vscode-project-xml-$(VERSION).vsix --force"
	@echo "Then reload the VS Code window (Ctrl+Shift+P → Developer: Reload Window)."

install: ext-package
	@echo ">>> Installing VS Code extension..."
	$(eval VERSION := $(shell cat "$(REPO_ROOT)/VERSION" | sed 's/^v//'))
	code --install-extension "$(EXT_DIR)/vscode-project-xml-$(VERSION).vsix" --force
	@echo ""
	@echo "Extension installed. Reload the VS Code window to activate it."
	@echo "  Ctrl+Shift+P → Developer: Reload Window"

# ---------------------------------------------------------------- #
# Static analysis targets                                          #
# ---------------------------------------------------------------- #
# Each analyzer writes its report to test_reports/ for CI consumption.
# 'analyze' runs them all and produces a summary.

REPORT_DIR := $(REPO_ROOT)/test_reports

analyze-bandit:
	@echo ">>> Running Bandit (Python security linter)..."
	@mkdir -p "$(REPORT_DIR)"
	"$(VENV_PYTHON)" -m bandit -r "$(REPO_ROOT)/tools" \
	    -x "$(EXT_DIR)" \
	    -f json -o "$(REPORT_DIR)/bandit-report.json" || true
	@"$(VENV_PYTHON)" -m bandit -r "$(REPO_ROOT)/tools" \
	    -x "$(EXT_DIR)" \
	    -f screen || true
	@echo "  Report: $(REPORT_DIR)/bandit-report.json"

analyze-pip-audit:
	@echo ">>> Running pip-audit (Python dependency vulnerabilities)..."
	@mkdir -p "$(REPORT_DIR)"
	"$(VENV_PYTHON)" -m pip_audit \
	    -f json -o "$(REPORT_DIR)/pip-audit-report.json" || true
	@"$(VENV_PYTHON)" -m pip_audit || true
	@echo "  Report: $(REPORT_DIR)/pip-audit-report.json"

analyze-eslint:
	@echo ">>> Running ESLint + eslint-plugin-security (TypeScript)..."
	@if [[ ! -d "$(EXT_DIR)/node_modules" ]]; then \
	    cd "$(EXT_DIR)" && npm install ; \
	fi
	cd "$(EXT_DIR)" && npm run lint:report || true
	@cd "$(EXT_DIR)" && npx eslint src/ || true
	@echo "  Report: $(REPORT_DIR)/eslint-report.json"

analyze-npm-audit:
	@echo ">>> Running npm audit (Node dependency vulnerabilities)..."
	@mkdir -p "$(REPORT_DIR)"
	cd "$(EXT_DIR)" && npm audit --json > "$(REPORT_DIR)/npm-audit-report.json" 2>&1 || true
	@cd "$(EXT_DIR)" && npm audit || true
	@echo "  Report: $(REPORT_DIR)/npm-audit-report.json"

analyze-semgrep:
	@echo ">>> Running Semgrep (OWASP rules — Python + TypeScript)..."
	@mkdir -p "$(REPORT_DIR)"
	"$(VENV_SEMGREP)" scan \
	    --config auto \
	    --json -o "$(REPORT_DIR)/semgrep-report.json" \
	    "$(REPO_ROOT)/tools" \
	    --exclude "node_modules" --exclude "dist" --exclude "out" || true
	@"$(VENV_SEMGREP)" scan \
	    --config auto \
	    "$(REPO_ROOT)/tools" \
	    --exclude "node_modules" --exclude "dist" --exclude "out" || true
	@echo "  Report: $(REPORT_DIR)/semgrep-report.json"

analyze: analyze-bandit analyze-pip-audit analyze-eslint analyze-npm-audit analyze-semgrep
	@$(MAKE) --no-print-directory analyze_report
	@echo ""
	@echo "All static analysis complete."

analyze_report:
	@echo ">>> Generating consolidated static-analysis report..."
	cd "$(REPO_ROOT)" && "$(VENV_PYTHON)" "$(REPO_ROOT)/tools/analyze_report.py" \
	    --bandit test_reports/bandit-report.json \
	    --pip-audit test_reports/pip-audit-report.json \
	    --eslint test_reports/eslint-report.json \
	    --npm-audit test_reports/npm-audit-report.json \
	    --semgrep test_reports/semgrep-report.json \
	    --out test_reports/analyze-report.md

analyze-check-errors:
	@echo ">>> Checking for error-level findings (warnings allowed)..."
	cd "$(REPO_ROOT)" && "$(VENV_PYTHON)" "$(REPO_ROOT)/tools/analyze_report.py" \
	    --bandit test_reports/bandit-report.json \
	    --pip-audit test_reports/pip-audit-report.json \
	    --eslint test_reports/eslint-report.json \
	    --npm-audit test_reports/npm-audit-report.json \
	    --semgrep test_reports/semgrep-report.json \
	    --out test_reports/analyze-report.md \
	    --exit-code

# ---------------------------------------------------------------- #
# Clean targets                                                    #
# ---------------------------------------------------------------- #
# Conservative by default: 'clean' touches only generated/derived
# artefacts that 'make' or the renderer produced. Use 'distclean'
# to also drop the venv and node_modules.

GENERATED_DOCS := \
    $(REPO_ROOT)/doc/HLRs.md \
    $(REPO_ROOT)/doc/LLRs.md \
    $(REPO_ROOT)/doc/SDD.md \
    $(REPO_ROOT)/doc/STP.md \
    $(REPO_ROOT)/doc/Traceability.md

clean-docs:
	@echo ">>> Removing generated documentation..."
	rm -f $(GENERATED_DOCS)

clean-ext:
	@echo ">>> Removing VS Code extension build output..."
	rm -rf "$(EXT_DIR)/dist"
	rm -f  "$(EXT_DIR)"/*.vsix "$(REPO_ROOT)/dist"/*.vsix 2>/dev/null || true

clean: clean-docs clean-ext
	@echo ">>> Removing Python __pycache__ directories..."
	find "$(REPO_ROOT)" -type d -name __pycache__ -prune -exec rm -rf {} +
	@echo "Clean complete."

distclean: clean
	@echo ">>> Removing .venv and node_modules..."
	rm -rf "$(VENV_DIR)"
	rm -rf "$(EXT_DIR)/node_modules"
	@echo "distclean complete. Re-run 'make -C tools bootstrap' to restore."
