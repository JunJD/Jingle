#!/usr/bin/env python3
"""Jingle-owned Linux semantic computer-use backend.

The process accepts one JSON request from stdin. Successful requests
write one raw JSON response; errors write one JSON diagnostic to stderr and exit
nonzero. It intentionally has no coordinate, XTest, portal, or global-input path.
X11 targets are bound to a real XID; Wayland is accepted only when the AT-SPI
implementation exposes a stable native window handle.
"""

from __future__ import annotations

import ctypes
import ctypes.util
import hashlib
import json
import os
import sys
import time
from dataclasses import dataclass
from typing import Any, Iterable


MAX_ELEMENTS = 500
MAX_DEPTH = 12
PROTOCOL_VERSION = 1
PRESS_ACTION_NAMES = {"activate", "click", "press", "toggle"}
SCROLL_ACTION_NAMES = {
    "scroll down",
    "scroll left",
    "scroll right",
    "scroll up",
    "scroll-down",
    "scroll-left",
    "scroll-right",
    "scroll-up",
}


class BackendError(Exception):
    def __init__(self, code: str, message: str, details: dict[str, Any] | None = None):
        super().__init__(message)
        self.code = code
        self.details = details or {}


@dataclass(frozen=True)
class Target:
    application: Any
    application_id: str
    application_name: str
    native_id: str
    pid: int
    process_start: str
    window: Any
    window_fingerprint: str

    @property
    def generation(self) -> str:
        material = f"{self.pid}\0{self.process_start}\0{self.native_id}\0{self.window_fingerprint}"
        return hashlib.sha256(material.encode("utf-8")).hexdigest()

    @property
    def resource_key(self) -> str:
        return f"linux:{self.pid}:{self.native_id}:{self.generation}"


def _sha(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _text(value: Any) -> str:
    try:
        return str(value or "")
    except Exception:
        return ""


def _attributes(accessible: Any) -> dict[str, str]:
    result: dict[str, str] = {}
    try:
        raw = accessible.getAttributes()
    except Exception:
        raw = []
    for item in raw or []:
        if ":" not in item:
            continue
        key, value = item.split(":", 1)
        result[key.strip().lower()] = value.strip()
    return result


def _process_start(pid: int) -> str:
    try:
        # Field 22 follows the final ')' because comm may contain spaces.
        fields = open(f"/proc/{pid}/stat", "r", encoding="utf-8").read().rsplit(")", 1)[1].split()
        return fields[19]
    except (OSError, IndexError) as error:
        raise BackendError("unavailable", f"Cannot bind process generation for pid {pid}.") from error


def _application_executable_id(pid: int) -> str:
    try:
        executable = os.path.realpath(f"/proc/{pid}/exe")
    except OSError as error:
        raise BackendError(
            "unavailable", f"Cannot resolve the executable owner for pid {pid}."
        ) from error
    if not executable or not os.path.isabs(executable) or not os.path.exists(executable):
        raise BackendError("unavailable", f"Cannot bind an executable owner for pid {pid}.")
    return f"linux-exe:{executable}"


def _application_pid(application: Any) -> int:
    candidates = [application]
    get_application = getattr(application, "getApplication", None)
    if callable(get_application):
        try:
            candidates.append(get_application())
        except Exception:
            pass
    for candidate in candidates:
        if candidate is None:
            continue
        for name in ("get_process_id", "getProcessId"):
            method = getattr(candidate, name, None)
            if callable(method):
                try:
                    pid = int(method())
                    if pid > 0:
                        return pid
                except Exception:
                    pass
    attrs = _attributes(application)
    for key in ("process-id", "pid"):
        try:
            pid = int(attrs.get(key, "0"))
            if pid > 0:
                return pid
        except ValueError:
            pass
    return 0


def _children_with_completeness(accessible: Any) -> tuple[list[tuple[int, Any]], bool]:
    try:
        raw_count = max(0, int(accessible.childCount))
    except Exception:
        return [], False
    children: list[tuple[int, Any]] = []
    complete = raw_count <= MAX_ELEMENTS
    for index in range(min(raw_count, MAX_ELEMENTS)):
        try:
            child = accessible.getChildAtIndex(index)
        except Exception:
            complete = False
            continue
        if child is not None:
            children.append((index, child))
        else:
            complete = False
    return children, complete


def _children(accessible: Any) -> Iterable[tuple[int, Any]]:
    children, _ = _children_with_completeness(accessible)
    return iter(children)


def _role(accessible: Any) -> str:
    try:
        return _text(accessible.getRoleName()).lower()
    except Exception:
        return "unknown"


def _accessible_path(accessible: Any) -> str:
    for key in ("_acc_path", "object_path", "path"):
        value = getattr(accessible, key, None)
        if value:
            return _text(value)
    attrs = _attributes(accessible)
    return attrs.get("id", "") or attrs.get("accessible-id", "")


def _wayland_native_id(window: Any) -> str | None:
    attrs = _attributes(window)
    for key in ("native-window-id", "window-id", "wayland-window-id", "surface-id"):
        value = attrs.get(key, "").strip()
        if value and value not in {"0", "0x0"}:
            return value
    return None


class X11Windows:
    """Small libX11 reader used only to bind an AT-SPI window to a real XID."""

    def __init__(self) -> None:
        library = ctypes.util.find_library("X11")
        if not library:
            raise BackendError("unavailable", "libX11 is unavailable.")
        self.x = ctypes.CDLL(library)
        self.x.XOpenDisplay.argtypes = [ctypes.c_char_p]
        self.x.XOpenDisplay.restype = ctypes.c_void_p
        self.x.XCloseDisplay.argtypes = [ctypes.c_void_p]
        self.x.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
        self.x.XDefaultRootWindow.restype = ctypes.c_ulong
        self.x.XInternAtom.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int]
        self.x.XInternAtom.restype = ctypes.c_ulong
        self.x.XGetWindowProperty.argtypes = [
            ctypes.c_void_p, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_long, ctypes.c_long,
            ctypes.c_int, ctypes.c_ulong, ctypes.POINTER(ctypes.c_ulong),
            ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_ulong),
            ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.POINTER(ctypes.c_ubyte)),
        ]
        self.x.XGetWindowProperty.restype = ctypes.c_int
        self.x.XFree.argtypes = [ctypes.c_void_p]
        self.display = self.x.XOpenDisplay(None)
        if not self.display:
            raise BackendError("unavailable", "Cannot open the X11 display.")

    def close(self) -> None:
        if self.display:
            self.x.XCloseDisplay(self.display)
            self.display = None

    def _atom(self, name: str) -> int:
        return int(self.x.XInternAtom(self.display, name.encode("ascii"), 0))

    def _property(self, window: int, name: str) -> tuple[int, int, bytes]:
        actual_type = ctypes.c_ulong()
        actual_format = ctypes.c_int()
        count = ctypes.c_ulong()
        remaining = ctypes.c_ulong()
        data = ctypes.POINTER(ctypes.c_ubyte)()
        status = self.x.XGetWindowProperty(
            self.display, window, self._atom(name), 0, 65536, 0, 0,
            ctypes.byref(actual_type), ctypes.byref(actual_format), ctypes.byref(count),
            ctypes.byref(remaining), ctypes.byref(data),
        )
        if status != 0 or not data:
            return 0, 0, b""
        try:
            # Xlib represents format-32 values as arrays of C unsigned long.
            width = ctypes.sizeof(ctypes.c_ulong) if actual_format.value == 32 else max(1, actual_format.value // 8)
            return actual_type.value, actual_format.value, ctypes.string_at(data, count.value * width)
        finally:
            self.x.XFree(data)

    def clients(self) -> list[int]:
        root = int(self.x.XDefaultRootWindow(self.display))
        _, width, raw = self._property(root, "_NET_CLIENT_LIST_STACKING")
        if width not in (32, 64):
            _, width, raw = self._property(root, "_NET_CLIENT_LIST")
        item_size = ctypes.sizeof(ctypes.c_ulong)
        if not raw or len(raw) % item_size:
            return []
        return [int.from_bytes(raw[offset:offset + item_size], sys.byteorder) for offset in range(0, len(raw), item_size)]

    def pid(self, window: int) -> int:
        _, _, raw = self._property(window, "_NET_WM_PID")
        return int.from_bytes(raw[:4], sys.byteorder) if len(raw) >= 4 else 0

    def title(self, window: int) -> str:
        _, _, raw = self._property(window, "_NET_WM_NAME")
        return raw.rstrip(b"\0").decode("utf-8", "replace")


def _x11_window(pid: int, title: str, requested_id: str | None) -> tuple[str, str]:
    x11 = X11Windows()
    try:
        candidates = [(window, x11.title(window)) for window in x11.clients() if x11.pid(window) == pid]
        if requested_id:
            try:
                requested = int(requested_id, 0)
            except ValueError as error:
                raise BackendError("refused", "The requested X11 window id is invalid.") from error
            candidates = [candidate for candidate in candidates if candidate[0] == requested]
            candidates = [
                candidate
                for candidate in candidates
                if not title
                or candidate[1] == title
                or title in candidate[1]
                or candidate[1] in title
            ]
        elif title:
            exact = [candidate for candidate in candidates if candidate[1] == title]
            candidates = exact or [candidate for candidate in candidates if title in candidate[1] or candidate[1] in title]
        if len(candidates) != 1:
            raise BackendError(
                "unavailable",
                "AT-SPI window cannot be bound unambiguously to one X11 window.",
                {"candidateCount": len(candidates)},
            )
        xid, native_title = candidates[0]
        return hex(xid), native_title
    finally:
        x11.close()


def _select_target(request: dict[str, Any], expected_pid: int | None = None) -> Target:
    try:
        import pyatspi  # type: ignore
    except ImportError as error:
        raise BackendError("unavailable", "pyatspi/AT-SPI is unavailable.") from error

    desktop = pyatspi.Registry.getDesktop(0)
    requested_app_id = _text(request.get("applicationId"))
    requested_app_name = _text(request.get("applicationName"))
    requested_window_id = _text(request.get("windowId")) or None
    matches: list[tuple[Any, Any, int, str]] = []
    for _, application in _children(desktop):
        app_name = _text(getattr(application, "name", ""))
        pid = _application_pid(application)
        if pid <= 0 or (expected_pid is not None and pid != expected_pid):
            continue
        try:
            app_id = _application_executable_id(pid)
        except BackendError:
            continue
        if requested_app_id and requested_app_id != app_id:
            continue
        if requested_app_name and requested_app_name.casefold() not in app_name.casefold():
            continue
        for _, window in _children(application):
            if _role(window) in {"frame", "window", "dialog", "alert"}:
                matches.append((application, window, pid, app_id))
    if not matches:
        raise BackendError(
            "unavailable",
            "No accessible application window matches the request.",
        )
    session_type = os.environ.get("XDG_SESSION_TYPE", "").lower()
    if session_type not in {"", "x11", "wayland"}:
        raise BackendError("unavailable", f"Unsupported Linux session type: {session_type}.")
    bound: list[Target] = []
    for application, window, pid, app_id in matches:
        app_name = _text(getattr(application, "name", ""))
        attrs = _attributes(application)
        atspi_app_id = attrs.get("application-id", "") or attrs.get("id", "")
        title = _text(getattr(window, "name", ""))
        try:
            if session_type == "wayland":
                native_id = _wayland_native_id(window)
                if not native_id or (requested_window_id and native_id != requested_window_id):
                    continue
            else:
                native_id, _ = _x11_window(pid, title, requested_window_id)
        except BackendError:
            continue
        # Titles and values are mutable UI state. Resource generation may only
        # use process/native-handle ownership plus stable AT-SPI identity.
        accessible_fingerprint = "\0".join(
            (app_id, atspi_app_id, app_name, _role(window), _accessible_path(window))
        )
        bound.append(
            Target(
                application=application,
                application_id=app_id,
                application_name=app_name,
                native_id=native_id,
                pid=pid,
                process_start=_process_start(pid),
                window=window,
                window_fingerprint=_sha(accessible_fingerprint),
            )
        )
    if len(bound) != 1:
        message = (
            "Wayland AT-SPI does not expose one stable native window handle for this target."
            if session_type == "wayland"
            else "AT-SPI window cannot be bound unambiguously to one X11 window."
        )
        raise BackendError("unavailable", message, {"candidateCount": len(bound)})
    return bound[0]


def _action_names(accessible: Any) -> tuple[Any | None, list[str]]:
    try:
        interface = accessible.queryAction()
        return interface, [_text(interface.getName(index)).lower() for index in range(interface.nActions)]
    except Exception:
        return None, []


def _editable(accessible: Any) -> Any | None:
    try:
        return accessible.queryEditableText()
    except Exception:
        return None


def _value(accessible: Any) -> str | None:
    try:
        text = accessible.queryText()
        return _text(text.getText(0, text.characterCount))
    except Exception:
        pass
    try:
        return _text(accessible.queryValue().currentValue)
    except Exception:
        return None


def _element_actions(accessible: Any) -> list[str]:
    _, names = _action_names(accessible)
    actions: list[str] = []
    if any(name in PRESS_ACTION_NAMES for name in names):
        actions.append("press")
    if _editable(accessible) is not None:
        actions.extend(("set_value", "type_text"))
    if any(name in SCROLL_ACTION_NAMES for name in names):
        actions.append("scroll")
    return actions


def _semantic_tree(target: Target) -> tuple[list[dict[str, Any]], dict[str, Any], bool]:
    elements: list[dict[str, Any]] = []
    resolved: dict[str, Any] = {}
    stack: list[tuple[Any, tuple[int, ...], int]] = [(target.window, (), 0)]
    source_truncated = False
    while stack and len(elements) < MAX_ELEMENTS:
        accessible, path, depth = stack.pop()
        actions = _element_actions(accessible)
        if actions:
            role = _role(accessible)
            title = _text(getattr(accessible, "name", ""))
            identifier = _attributes(accessible).get("id", "") or _accessible_path(accessible)
            signature = f"{target.generation}\0{'.'.join(map(str, path))}\0{role}\0{identifier}\0{title}"
            ref = f"linux:{_sha(signature)[:24]}"
            element: dict[str, Any] = {
                "actions": actions,
                "index": len(elements),
                "ref": ref,
                "role": role,
            }
            if title:
                element["title"] = title
            if identifier:
                element["identifier"] = identifier
            value = _value(accessible)
            if value is not None:
                element["value"] = value
            elements.append(element)
            resolved[ref] = accessible
        children, children_complete = _children_with_completeness(accessible)
        if not children_complete:
            source_truncated = True
        if depth >= MAX_DEPTH:
            if children:
                source_truncated = True
            continue
        for index, child in reversed(children):
            stack.append((child, path + (index,), depth + 1))
    if stack:
        source_truncated = True
    return elements, resolved, source_truncated


def _target_identity(target: Target) -> dict[str, Any]:
    return {
        "application": {"id": target.application_id, "name": target.application_name},
        "resourceKey": target.resource_key,
        "window": {
            "generation": target.generation,
            "nativeId": target.native_id,
            "pid": target.pid,
            "platform": "linux",
        },
    }


def _require_target_identity(request: dict[str, Any]) -> dict[str, Any]:
    target = request.get("target")
    if not isinstance(target, dict) or set(target) != {"application", "resourceKey", "window"}:
        raise BackendError("refused", "Observe requires an authorized target identity.")
    application = target.get("application")
    window = target.get("window")
    if (
        not isinstance(application, dict)
        or set(application) != {"id", "name"}
        or not isinstance(application.get("id"), str)
        or not application["id"]
        or not isinstance(application.get("name"), str)
        or not application["name"]
        or not isinstance(target.get("resourceKey"), str)
        or not target["resourceKey"]
        or not isinstance(window, dict)
        or set(window) != {"generation", "nativeId", "pid", "platform"}
        or not isinstance(window.get("generation"), str)
        or not window["generation"]
        or not isinstance(window.get("nativeId"), str)
        or not window["nativeId"]
        or type(window.get("pid")) is not int
        or window["pid"] <= 0
        or window.get("platform") != "linux"
    ):
        raise BackendError("refused", "Observe requires an authorized target identity.")
    return target


def _identify(request: dict[str, Any]) -> dict[str, Any]:
    return _target_identity(_select_target(request))


def _observe(request: dict[str, Any]) -> dict[str, Any]:
    expected = _require_target_identity(request)
    expected_application = expected["application"]
    expected_window = expected["window"]
    target = _select_target(
        {
            "applicationId": expected_application["id"],
            "windowId": expected_window["nativeId"],
        },
        expected_pid=expected_window["pid"],
    )
    current = _target_identity(target)
    if current != expected:
        raise BackendError(
            "refused",
            "Target application, window, or resource identity changed before observation.",
        )
    elements, _, source_truncated = _semantic_tree(target)
    return {
        "application": current["application"],
        "capturedAt": int(time.time() * 1000),
        "elements": elements,
        "resourceKey": current["resourceKey"],
        "sourceTruncated": source_truncated,
        "window": current["window"],
    }


def _evidence(route: str, verification: str, no_side_effect: bool) -> dict[str, Any]:
    return {
        "delivery": "semantic",
        "noSideEffectProof": no_side_effect,
        "route": route,
        "verification": verification,
    }


def _execute_action(accessible: Any, action: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    kind = action.get("kind")
    if kind in {"set_value", "type_text"}:
        editable = _editable(accessible)
        desired = action.get("value")
        if editable is None or not isinstance(desired, str):
            return "refused", _evidence("at_spi_editable_text", "failed", True)
        before = _value(accessible)
        try:
            result = editable.setTextContents(desired)
        except Exception:
            return "unknown", _evidence("at_spi_editable_text", "unverifiable", False)
        after = _value(accessible)
        if after == desired:
            return "worked", _evidence("at_spi_editable_text", "verified", False)
        if result is False and after == before:
            return "didnt", _evidence("at_spi_editable_text", "failed", True)
        return "unknown", _evidence("at_spi_editable_text", "unverifiable", False)

    interface, names = _action_names(accessible)
    allowed = PRESS_ACTION_NAMES if kind == "press" else SCROLL_ACTION_NAMES if kind == "scroll" else set()
    if interface is None or not allowed:
        return "refused", _evidence("unavailable", "failed", True)
    matching = [index for index, name in enumerate(names) if name in allowed]
    if kind == "scroll":
        amount = action.get("scrollAmount", 0)
        direction = "down" if isinstance(amount, (int, float)) and amount > 0 else "up"
        directed = [index for index in matching if direction in names[index]]
        matching = directed or matching
    if not matching:
        return "refused", _evidence("at_spi_action", "failed", True)
    before = (_value(accessible), _text(getattr(accessible, "name", "")), _attributes(accessible))
    try:
        dispatched = interface.doAction(matching[0])
    except Exception:
        return "unknown", _evidence("at_spi_action", "unverifiable", False)
    after = (_value(accessible), _text(getattr(accessible, "name", "")), _attributes(accessible))
    if after != before:
        return "worked", _evidence("at_spi_action", "verified", False)
    if dispatched is False:
        return "didnt", _evidence("at_spi_action", "failed", True)
    return "unknown", _evidence("at_spi_action", "unverifiable", False)


def _execute(request: dict[str, Any]) -> dict[str, Any]:
    base = request.get("base") or {}
    # Linux mutation remains packaged for platform verification but is not
    # reachable until the environment probe can promote the same routes.
    return {
        "baseStateId": base.get("stateId", ""),
        "outcome": "unavailable",
        "steps": [],
    }

    base_window = base.get("window") or {}
    authorization = request.get("authorization") or {}
    authorized_window = authorization.get("window") or {}
    if not authorization or int(authorization.get("expiresAt", 0)) <= int(time.time() * 1000):
        raise BackendError("refused", "Computer-use authorization is missing or expired.")
    if authorized_window != base_window:
        raise BackendError("refused", "Authorization is not bound to the observed target resource.")
    target = _select_target(
        {
            "applicationId": (base.get("application") or {}).get("id"),
            "windowId": base_window.get("nativeId"),
        }
    )
    if (
        base_window.get("platform") != "linux"
        or int(base_window.get("pid", 0)) != target.pid
        or base_window.get("nativeId") != target.native_id
        or base_window.get("generation") != target.generation
        or base.get("resourceKey") != target.resource_key
    ):
        raise BackendError("refused", "The target resource identity is stale or no longer bound.")
    if request.get("delivery") != "background":
        raise BackendError("unavailable", "Linux foreground/global input is not implemented.")
    actions = request.get("actions") or []
    if not isinstance(actions, list) or not actions:
        raise BackendError("refused", "A non-empty semantic action list is required.")

    _, resolved, _ = _semantic_tree(target)
    steps: list[dict[str, Any]] = []
    aggregate = "worked"
    stopped_at: int | None = None
    for index, action in enumerate(actions):
        accessible = resolved.get(action.get("ref"))
        if accessible is None:
            route = "at_spi_editable_text" if action.get("kind") in {"set_value", "type_text"} else "at_spi_action"
            outcome, evidence = "refused", _evidence(route, "failed", True)
        else:
            outcome, evidence = _execute_action(accessible, action)
        steps.append({"action": action, "evidence": evidence, "outcome": outcome})
        if outcome != "worked":
            aggregate = outcome
            stopped_at = index
            break
    result: dict[str, Any] = {
        "baseStateId": base.get("stateId", ""),
        "outcome": aggregate,
        "steps": steps,
    }
    if stopped_at is not None:
        result["stoppedAt"] = stopped_at
    return result


def _capability_matrix(environment: str, available: bool) -> dict[str, Any]:
    semantic = "verified" if available else "unavailable"
    return {
        "environment": environment,
        "platform": "linux",
        "protocolVersion": PROTOCOL_VERSION,
        "capabilities": [
            {"action": "activate", "background": "unavailable", "foreground": "unavailable", "route": "unavailable"},
            {"action": "press", "background": semantic, "foreground": "unavailable", "route": "at_spi_action"},
            {"action": "set_value", "background": semantic, "foreground": "unavailable", "route": "at_spi_editable_text"},
            {"action": "type_text", "background": semantic, "foreground": "unavailable", "route": "at_spi_editable_text"},
            {"action": "keypress", "background": "refused", "foreground": "unavailable", "route": "unavailable"},
            {"action": "scroll", "background": semantic, "foreground": "unavailable", "route": "at_spi_action"},
        ],
    }


def _detected_environment() -> str:
    session_type = os.environ.get("XDG_SESSION_TYPE", "").strip().lower()
    if session_type == "x11":
        return "linux-x11"
    if session_type == "wayland":
        desktop = os.environ.get("XDG_CURRENT_DESKTOP", "").lower()
        compositor = "gnome" if "gnome" in desktop else "kde" if "kde" in desktop else "other"
        return f"linux-wayland-{compositor}"
    raise BackendError("unavailable", "A supported Linux session environment is required.")


def _operation_response(
    environment: str, method: str, result: dict[str, Any]
) -> dict[str, Any]:
    return {
        "environment": environment,
        "method": method,
        "protocolVersion": PROTOCOL_VERSION,
        "result": result,
    }


def _operation_environment(payload: dict[str, Any]) -> str:
    environment = _detected_environment()
    protocol_version = payload.get("protocolVersion")
    if (
        payload.get("environment") != environment
        or type(protocol_version) is not int
        or protocol_version != PROTOCOL_VERSION
    ):
        raise BackendError(
            "unavailable", "Computer-use request belongs to another environment or protocol."
        )
    return environment


def _probe(payload: dict[str, Any]) -> dict[str, Any]:
    session_type = os.environ.get("XDG_SESSION_TYPE", "").lower() or "x11"
    requested = str(payload.get("environment") or "")
    detected = _detected_environment()
    supported = {
        "linux-x11",
        "linux-wayland-gnome",
        "linux-wayland-kde",
        "linux-wayland-other",
    }
    if requested not in supported:
        raise BackendError("refused", "A supported Linux backend environment is required.")
    if requested != detected:
        return _capability_matrix(requested, False)
    try:
        import pyatspi  # type: ignore  # noqa: F401
    except ImportError:
        return _capability_matrix(requested, False)
    if session_type == "x11":
        try:
            x11 = X11Windows()
            x11.close()
        except BackendError:
            return _capability_matrix(requested, False)
        # The source and observation path are packaged, but Linux mutation is
        # not promoted until the X11 behavior matrix runs on a real target.
        return _capability_matrix(requested, False)
    if session_type == "wayland":
        # A process-wide probe cannot prove that a specific AT-SPI window has
        # a stable compositor-owned native handle. Targeted actions stay off.
        return _capability_matrix(requested, False)
    return _capability_matrix(requested, False)


def _dispatch(payload: dict[str, Any]) -> Any:
    method = payload.get("method")
    if method == "probe":
        return _probe(payload)
    if method == "identify":
        environment = _operation_environment(payload)
        return _operation_response(environment, "identify", _identify(payload.get("request") or {}))
    if method == "observe":
        environment = _operation_environment(payload)
        return _operation_response(environment, "observe", _observe(payload.get("request") or {}))
    if method == "execute":
        environment = _operation_environment(payload)
        return _operation_response(environment, "execute", _execute(payload.get("request") or {}))
    if method == "dispose_session":
        return None
    raise BackendError("refused", f"Unsupported method: {method!r}.")


def main() -> int:
    try:
        if len(sys.argv) > 1:
            raise BackendError("invalid_request", "Computer Use requests must use stdin.")
        raw = sys.stdin.read()
        payload = json.loads(raw)
        if not isinstance(payload, dict):
            raise BackendError("refused", "Request must be a JSON object.")
        response = _dispatch(payload)
    except BackendError as error:
        print(
            json.dumps(
                {"code": error.code, "details": error.details, "message": str(error)},
                separators=(",", ":"),
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        return 1
    except (json.JSONDecodeError, TypeError, ValueError) as error:
        print(
            json.dumps(
                {"code": "refused", "details": {}, "message": str(error)},
                separators=(",", ":"),
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        return 1
    except Exception as error:
        print(
            json.dumps(
                {"code": "unknown", "details": {}, "message": str(error)},
                separators=(",", ":"),
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        return 1
    json.dump(response, sys.stdout, separators=(",", ":"), sort_keys=True)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
