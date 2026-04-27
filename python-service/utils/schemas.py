from typing import Dict, Optional

from pydantic import BaseModel, Field


class CallbackConfig(BaseModel):
    url: str
    headers: Dict[str, str] = Field(default_factory=dict)


class FileJobRequest(BaseModel):
    file_path: str
    user_id: Optional[str] = None
    file_id: Optional[str] = None
    original_name: Optional[str] = None
    callback: Optional[CallbackConfig] = None


class StreamStartRequest(BaseModel):
    camera_id: str
    stream_url: str
    user_id: Optional[str] = None
    zone_name: Optional[str] = None


class StreamStopRequest(BaseModel):
    camera_id: str
