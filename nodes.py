import json
import urllib.request
import urllib.error

DEFAULT_ENGINE_URL = "http://127.0.0.1:3001"


def _request_json(method: str, url: str, payload=None, api_key: str = ""):
    data = None
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url=url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            raw = resp.read().decode("utf-8")
            return True, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        try:
            body = e.read().decode("utf-8")
        except Exception:
            body = str(e)
        return False, {"error": f"HTTP {e.code}", "details": body}
    except Exception as e:
        return False, {"error": str(e)}


class ModusnapManagerStatus:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "engine_url": ("STRING", {"default": DEFAULT_ENGINE_URL}),
                "api_key": ("STRING", {"default": ""}),
            }
        }

    RETURN_TYPES = ("STRING", "STRING", "INT")
    RETURN_NAMES = ("manager_state", "hardware_profile", "node_count")
    FUNCTION = "run"
    CATEGORY = "modusnap/manager"

    def run(self, engine_url, api_key):
        ok, payload = _request_json("GET", f"{engine_url}/api/manager/status", api_key=api_key)
        if not ok:
            return ("down", "unknown", 0)
        state = "active" if payload.get("managerRoutesReachable") else "degraded"
        return (state, str(payload.get("hardwareProfile", "unknown")), int(payload.get("nodeCount", 0) or 0))


class ModusnapManagerCatalog:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "engine_url": ("STRING", {"default": DEFAULT_ENGINE_URL}),
                "api_key": ("STRING", {"default": ""}),
                "search": ("STRING", {"default": ""}),
            }
        }

    RETURN_TYPES = ("STRING", "INT")
    RETURN_NAMES = ("catalog_json", "pack_count")
    FUNCTION = "run"
    CATEGORY = "modusnap/manager"

    def run(self, engine_url, api_key, search):
        ok, payload = _request_json("GET", f"{engine_url}/api/manager/catalog?mode=cache&skip_update=true", api_key=api_key)
        if not ok:
            return (json.dumps(payload), 0)
        packs = payload.get("node_packs", {}) or {}
        q = (search or "").strip().lower()
        if q:
            packs = {
                key: val
                for key, val in packs.items()
                if q in key.lower() or q in str((val or {}).get("title", "")).lower()
            }
        return (json.dumps(packs)[:200000], len(packs))


class ModusnapManagerBatchInstall:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "engine_url": ("STRING", {"default": DEFAULT_ENGINE_URL}),
                "api_key": ("STRING", {"default": ""}),
                "pack_ids_csv": ("STRING", {"default": ""}),
                "mode": (["install", "uninstall", "update"],),
            }
        }

    RETURN_TYPES = ("BOOLEAN", "STRING")
    RETURN_NAMES = ("ok", "details")
    FUNCTION = "run"
    CATEGORY = "modusnap/manager"

    def run(self, engine_url, api_key, pack_ids_csv, mode):
        ids = [entry.strip() for entry in (pack_ids_csv or "").split(",") if entry.strip()]
        if not ids:
            return (False, "No pack ids provided.")

        items = [{"id": entry, "title": entry, "__uiKey": entry} for entry in ids]
        ok, payload = _request_json("POST", f"{engine_url}/api/manager/batch", {
            "mode": mode,
            "sourceMode": "cache",
            "channel": "default",
            "items": items,
        }, api_key)
        if not ok:
            return (False, json.dumps(payload)[:2000])
        return (True, json.dumps(payload)[:2000])


NODE_CLASS_MAPPINGS = {
    "ModusnapManagerStatus": ModusnapManagerStatus,
    "ModusnapManagerCatalog": ModusnapManagerCatalog,
    "ModusnapManagerBatchInstall": ModusnapManagerBatchInstall,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ModusnapManagerStatus": "Modusnap Manager Status",
    "ModusnapManagerCatalog": "Modusnap Manager Catalog",
    "ModusnapManagerBatchInstall": "Modusnap Manager Batch Install",
}
