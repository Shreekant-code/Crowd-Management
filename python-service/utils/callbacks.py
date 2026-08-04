import logging
from typing import Dict, Optional

import requests

from utils.config import CALLBACK_TIMEOUT


logger = logging.getLogger(__name__)


def post_callback(url: str, payload: Dict, headers: Optional[Dict[str, str]] = None) -> None:
    try:
        requests.post(
            url,
            json=payload,
            headers=headers or {},
            timeout=CALLBACK_TIMEOUT,
        ).raise_for_status()
    except requests.RequestException as error:
        logger.exception("callback_request_failed callback_url=%s", url, exc_info=error)
        raise
