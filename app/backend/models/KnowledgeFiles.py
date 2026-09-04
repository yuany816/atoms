from core.database import Base
from datetime import datetime
from sqlalchemy import Column, DateTime, Integer, String


class Knowledgefiles(Base):
    __tablename__ = "knowledgefiles"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    file_name = Column(String, nullable=False)
    file_type = Column(String, nullable=False)
    size_bytes = Column(Integer, nullable=True)
    chunk_count = Column(Integer, nullable=True)
    status = Column(String, nullable=True)
    note = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.now)
    updated_at = Column(DateTime(timezone=True), default=datetime.now, onupdate=datetime.now)