from core.database import Base
from datetime import datetime
from sqlalchemy import Boolean, Column, DateTime, Integer, String


class Skillpackages(Base):
    __tablename__ = "skillpackages"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    name = Column(String, nullable=False)
    file_name = Column(String, nullable=True)
    file_type = Column(String, nullable=False)
    scenes = Column(String, nullable=True)
    description = Column(String, nullable=True)
    usage = Column(String, nullable=True)
    content = Column(String, nullable=False)
    enabled = Column(Boolean, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.now)
    updated_at = Column(DateTime(timezone=True), default=datetime.now, onupdate=datetime.now)