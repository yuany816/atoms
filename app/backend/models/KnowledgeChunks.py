from core.database import Base
from datetime import datetime
from sqlalchemy import Column, DateTime, Integer, String


class Knowledgechunks(Base):
    __tablename__ = "knowledgechunks"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    file_id = Column(Integer, index=True, nullable=False)
    file_name = Column(String, nullable=True)
    chunk_index = Column(Integer, nullable=True)
    content = Column(String, nullable=False)
    embedding = Column(String, nullable=False)
    dim = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.now)
    updated_at = Column(DateTime(timezone=True), default=datetime.now, onupdate=datetime.now)