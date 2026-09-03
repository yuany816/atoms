from core.database import Base
from datetime import datetime
from sqlalchemy import Column, DateTime, Integer, String
from sqlalchemy.dialects.postgresql import JSONB


class Apprecords(Base):
    __tablename__ = "apprecords"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    project_id = Column(String(64), index=True, nullable=False)
    entity_type = Column(String(64), nullable=False)
    data = Column(JSONB, nullable=False)
    created_at = Column(DateTime(timezone=True), default=datetime.now)
    updated_at = Column(DateTime(timezone=True), default=datetime.now, onupdate=datetime.now)