from core.database import Base
from datetime import datetime
from sqlalchemy import Column, DateTime, Integer, String


class Generationlogs(Base):
    __tablename__ = "generationlogs"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    project_id = Column(String, index=True, nullable=True)
    model = Column(String, nullable=True)
    user_message = Column(String, nullable=False)
    assistant_message = Column(String, nullable=True)
    kb_sources = Column(String, nullable=True)
    skill_names = Column(String, nullable=True)
    query = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.now)
    updated_at = Column(DateTime(timezone=True), default=datetime.now, onupdate=datetime.now)