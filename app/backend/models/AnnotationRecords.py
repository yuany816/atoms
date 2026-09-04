from core.database import Base
from datetime import datetime
from sqlalchemy import Column, DateTime, Integer, String


class Annotationrecords(Base):
    __tablename__ = "annotationrecords"
    __table_args__ = {"extend_existing": True}

    id = Column(Integer, primary_key=True, index=True, autoincrement=True, nullable=False)
    log_id = Column(Integer, index=True, nullable=False)
    label = Column(String, nullable=False)
    note = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.now)
    updated_at = Column(DateTime(timezone=True), default=datetime.now, onupdate=datetime.now)