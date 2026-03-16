from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import AliasChoices, BaseModel, ConfigDict, Field


class FetchRequest(BaseModel):
    platform: str
    config: Dict[str, Any]
    source_id: str
    auth_data: Optional[Dict[str, Any]] = None
    response_formats: Optional[List[Literal["text", "markdown"]]] = None


class FetchV2Request(BaseModel):
    model_config = ConfigDict(extra="forbid")

    platform: str
    source_id: str = Field(validation_alias=AliasChoices("sourceId"))
    auth_data: Optional[Dict[str, Any]] = Field(
        default=None,
        validation_alias=AliasChoices("authData"),
    )
    driver: Optional[str] = None
    output: Optional[Dict[str, Any]] = None
    driver_options: Optional[Dict[str, Any]] = Field(
        validation_alias=AliasChoices("driverOptions"),
    )


class VerifyAuthRequest(BaseModel):
    platform: str
    auth_data: Optional[Dict[str, Any]] = None
    state_file: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("stateFile", "state_file"),
    )
    verify_script_path: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("verifyScriptPath", "verify_script_path"),
    )
    verify_args: Optional[Dict[str, Any]] = Field(
        default=None,
        validation_alias=AliasChoices("verifyArgs", "verify_args"),
    )
    verify_target_url: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("verifyTargetUrl", "verify_target_url"),
    )
    verify_timeout_ms: int = Field(
        default=60000,
        validation_alias=AliasChoices("verifyTimeoutMs", "verify_timeout_ms"),
    )
    verify_post_wait_ms: int = Field(
        default=3000,
        validation_alias=AliasChoices("verifyPostWaitMs", "verify_post_wait_ms"),
    )
    headless: bool = False


class VerifyAuthResponse(BaseModel):
    valid: bool
    message: str
    details: Optional[Dict[str, Any]] = None


class CleanItem(BaseModel):
    title: Optional[str] = None
    text: Optional[str] = None
    markdown: Optional[str] = None
    platform: str
    url: Optional[str] = None
    time: Optional[datetime] = None
    sourceId: str
    sourceType: str
    driver: Optional[str] = "python-gather"
    instanceId: Optional[str] = None
    tabId: Optional[str] = None
    instanceActive: Optional[bool] = None
    matchedKeywords: Optional[List[str]] = None
    keywordMatchScore: Optional[float] = None
    recordId: Optional[str] = None
    recordType: Optional[str] = None
    recordIndex: Optional[int] = None


class ErrorDetail(BaseModel):
    code: str
    message: str
    retryable: bool


class ErrorResponse(BaseModel):
    error: ErrorDetail


class AgentBrowserHeartbeatRequest(BaseModel):
    platform: str
    source_id: str = Field(validation_alias=AliasChoices("sourceId", "source_id"))
    owner_id: Optional[str] = Field(default=None, validation_alias=AliasChoices("ownerId", "owner_id"))
    session_key: Optional[str] = Field(default=None, validation_alias=AliasChoices("sessionKey", "session_key"))
    instance_id: str = Field(validation_alias=AliasChoices("instanceId", "instance_id"))
    verbose: bool = True


class AgentBrowserHeartbeatResponse(BaseModel):
    instanceId: str
    tabId: str
    instanceActive: bool
    ttlSeconds: int
    expiresAt: datetime


class UploadProfileResponse(BaseModel):
    success: bool
    message: str
    profile_name: str
    verified: bool = False
    details: Optional[Dict[str, Any]] = None


class SaveAuthStateRequest(BaseModel):
    platform: str
    auth_data: Dict[str, Any] = Field(
        validation_alias=AliasChoices("authData", "auth_data"),
    )
    name: Optional[str] = None


class SaveAuthStateResponse(BaseModel):
    success: bool
    stateFile: str
    profileName: str


class DeleteAuthStateRequest(BaseModel):
    state_file: str = Field(validation_alias=AliasChoices("stateFile", "state_file"))


class KeywordFilterConfigError(ValueError):
    pass
