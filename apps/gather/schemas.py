from datetime import UTC, datetime
from typing import Any, Dict, List, Optional, Union

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, model_validator


class FetchRequest(BaseModel):
    platform: str
    config: Dict[str, Any]
    source_id: str
    user_id: Optional[str] = None
    auth_data: Optional[Dict[str, Any]] = None
    keywords: List[str] = Field(default_factory=list)
    output_fields: Optional[List[str]] = None
    output_field_map: Optional[Dict[str, str]] = None
    output_keyword_scope: Optional[List[str]] = None
    output_type: Optional[str] = None


class FetchOutputConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    field: Union[List[str], Dict[str, str]]
    keywordScope: Optional[List[str]] = None
    type: Optional[str] = None


class FetchIntent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: str = "search"
    args: Dict[str, Any] = Field(default_factory=dict)


class FetchNetworkConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    proxy_profile: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("proxyProfile", "proxy_profile"),
    )


class FetchDriverConfig(BaseModel):
    model_config = ConfigDict(extra="allow")

    name: str
    filter: Dict[str, Any] = Field(default_factory=dict)
    script: Optional[FetchIntent] = None

    @model_validator(mode="after")
    def _validate_no_option(self):
        if isinstance(self.model_extra, dict) and "option" in self.model_extra:
            raise ValueError(
                "payload no longer accepts driver.option; move fields directly under driver (e.g. driver.headless)"
            )
        return self


class FetchApiRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    platform: str
    source_id: str = Field(validation_alias=AliasChoices("sourceId", "source_id"))
    user_id: Optional[str] = Field(default=None, validation_alias=AliasChoices("userId", "user_id"))
    intent: Optional[FetchIntent] = None
    keywords: List[str] = Field(default_factory=list)
    output: FetchOutputConfig
    driver: Optional[FetchDriverConfig] = None
    network: Optional[FetchNetworkConfig] = None

    @model_validator(mode="after")
    def _validate_driver_script(self):
        if self.intent is not None:
            raise ValueError(
                "payload no longer accepts top-level intent; move it to driver.script (e.g. driver.script.type / driver.script.args)"
            )
        if self.driver is None or self.driver.script is None:
            raise ValueError(
                "payload requires driver.script; please provide driver.script.type and driver.script.args"
            )
        return self


class FetchMeta(BaseModel):
    adapter: str
    strategyTried: List[str] = Field(default_factory=list)
    strategyUsed: str
    driverUsed: str


class FetchApiResponse(BaseModel):
    items: List["CleanItem"]
    meta: FetchMeta


class VerifyAuthRequest(BaseModel):
    platform: str
    auth_data: Optional[Dict[str, Any]] = None
    state_file: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("stateFile", "state_file"),
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
    title: Optional[str] = Field(default=None, exclude=True)
    text: Optional[str] = Field(default=None, exclude=True)
    markdown: Optional[str] = Field(default=None, exclude=True)
    platform: str
    url: Optional[str] = Field(default=None, exclude=True)
    time: Optional[datetime] = Field(default=None, exclude=True)
    sourceId: str
    sourceType: str
    recordId: str
    recordType: str
    recordTime: datetime
    recordContent: Dict[str, Any]
    schemaVersion: str = "content.v1"
    driver: Optional[str] = "python-gather"
    instanceId: Optional[str] = None
    tabId: Optional[str] = None
    instanceActive: Optional[bool] = None
    matchedKeywords: Optional[List[str]] = None
    keywordMatchScore: Optional[float] = None
    recordIndex: Optional[int] = None

    @model_validator(mode="before")
    @classmethod
    def _normalize_record_payload(cls, raw: Any) -> Any:
        if not isinstance(raw, dict):
            return raw

        payload = dict(raw)
        text = payload.get("text")
        markdown = payload.get("markdown")
        if text is None and isinstance(payload.get("recordContent"), dict):
            content_text = payload["recordContent"].get("text")
            if isinstance(content_text, str):
                text = content_text
        if markdown is None and isinstance(payload.get("recordContent"), dict):
            content_markdown = payload["recordContent"].get("markdown")
            if isinstance(content_markdown, str):
                markdown = content_markdown
        if text is None and isinstance(markdown, str):
            text = markdown
        if markdown is None and isinstance(text, str):
            markdown = text
        if isinstance(text, str):
            payload["text"] = text
        if isinstance(markdown, str):
            payload["markdown"] = markdown

        record_time = payload.get("recordTime", payload.get("time"))
        if record_time is None:
            record_time = datetime.now(UTC)
        payload["recordTime"] = record_time
        payload["time"] = payload.get("time") or record_time

        record_content = payload.get("recordContent")
        if not isinstance(record_content, dict):
            record_content = {}
        if isinstance(text, str) and text.strip():
            record_content["text"] = text
        if isinstance(markdown, str) and markdown.strip():
            record_content.setdefault("markdown", markdown)
        if isinstance(payload.get("url"), str) and payload["url"].strip():
            record_content.setdefault("url", payload["url"])
        payload["recordContent"] = record_content

        if payload.get("recordId") is None and payload.get("sourceId"):
            source_id = str(payload.get("sourceId")).strip() or "source"
            record_index = payload.get("recordIndex")
            if isinstance(record_index, int) and record_index > 0:
                payload["recordId"] = f"{source_id}:{record_index}"
            else:
                payload["recordId"] = f"{source_id}:{int(datetime.now(UTC).timestamp() * 1000)}"

        if payload.get("recordType") is None:
            payload["recordType"] = "message"

        payload.setdefault("schemaVersion", "content.v1")
        return payload


class ErrorDetail(BaseModel):
    code: str
    message: str
    retryable: bool


class ErrorResponse(BaseModel):
    error: ErrorDetail


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


FetchApiResponse.model_rebuild()
