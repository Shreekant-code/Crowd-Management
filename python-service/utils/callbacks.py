from typing import Dict, Optional

import requests

from utils.config import CALLBACK_TIMEOUT


def post_callback(url: str, payload: Dict, headers: Optional[Dict[str, str]] = None) -> None:
    requests.post(
        url,
        json=payload,
        headers=headers or {},
        timeout=CALLBACK_TIMEOUT,
    ).raise_for_status()
