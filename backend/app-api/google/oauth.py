def start_oauth(state: str):
    return {"ok": False, "stub": True, "state": state}


def complete_oauth(code: str, state: str):
    return {"ok": False, "stub": True, "code": code, "state": state}
