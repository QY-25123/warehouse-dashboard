import json
from datetime import datetime
from typing import Any, Optional
from pydantic import BaseModel, field_validator


class ForkliftResponse(BaseModel):
    id: int
    name: str
    status: str
    x: float
    y: float
    capacity: int = 50
    last_updated: datetime


class TaskResponse(BaseModel):
    id: int
    type: str
    forklift_id: Optional[int]
    status: str
    origin_zone: Optional[str]
    destination_zone: Optional[str]
    inventory_item_id: Optional[int] = None
    item_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class InventoryResponse(BaseModel):
    id: int
    item_name: str
    quantity: int
    location_zone: str
    last_updated: datetime


class InventoryTaskResponse(BaseModel):
    """Task row returned by GET /inventory/:id/tasks — includes forklift name."""
    id: int
    type: str
    forklift_id: Optional[int]
    forklift_name: Optional[str] = None
    status: str
    origin_zone: Optional[str]
    destination_zone: Optional[str]
    inventory_item_id: Optional[int] = None
    item_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class AlertResponse(BaseModel):
    id: int
    severity: str
    message: str
    resolved: bool
    created_at: datetime


class EventResponse(BaseModel):
    id: int
    type: str
    payload: dict[str, Any]
    timestamp: datetime

    @field_validator("payload", mode="before")
    @classmethod
    def _coerce_payload(cls, v: Any) -> Any:
        if isinstance(v, str):
            return json.loads(v)
        return v


# ── Auth / Admin models ──────────────────────────────────────────────────────

class UserProfile(BaseModel):
    id: str
    email: str
    role: str
    display_name: Optional[str]
    created_at: datetime


class CreateUserRequest(BaseModel):
    email: str
    password: str
    role: str = "operator"
    display_name: Optional[str] = None


# ── AI workflow models ────────────────────────────────────────────────────────

class AIPlanRequest(BaseModel):
    message: str


class AIExecuteRequest(BaseModel):
    plan: dict[str, Any]


class UpdateCapacityRequest(BaseModel):
    capacity: int
