import json
import os

import gspread
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials

_SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]


def get_client() -> gspread.Client:
    raw = os.environ.get("GOOGLE_OAUTH_JSON", "").strip()
    if not raw:
        raise RuntimeError("GOOGLE_OAUTH_JSON env var not set")
    d = json.loads(raw)
    creds = Credentials(
        token=d.get("token"),
        refresh_token=d["refresh_token"],
        token_uri=d["token_uri"],
        client_id=d["client_id"],
        client_secret=d["client_secret"],
        scopes=_SCOPES,
    )
    if not creds.valid:
        creds.refresh(Request())
    return gspread.Client(auth=creds)


def open_worksheet(sheet_id: str, sheet_name: str) -> gspread.Worksheet:
    sh = get_client().open_by_key(sheet_id)
    return sh.worksheet(sheet_name)
