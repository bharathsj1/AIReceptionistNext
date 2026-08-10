from datetime import datetime
import os
from pathlib import Path

from sqlalchemy import Boolean, Column, DateTime, Integer, JSON, String, Text, create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import scoped_session, sessionmaker

from shared.config import get_database_url

DATABASE_URL = get_database_url()

if DATABASE_URL.startswith("sqlite:///"):
    db_path = DATABASE_URL.replace("sqlite:///", "", 1)
    if db_path and db_path != ":memory:":
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)


def _engine_kwargs(database_url: str) -> dict:
    kwargs = {"future": True, "pool_pre_ping": True}
    if database_url.startswith("postgresql"):
        kwargs["connect_args"] = {"connect_timeout": int(os.getenv("DB_CONNECT_TIMEOUT", "10"))}
        kwargs["pool_recycle"] = int(os.getenv("DB_POOL_RECYCLE_SECONDS", "300"))
        kwargs["pool_use_lifo"] = True
    return kwargs


engine = create_engine(DATABASE_URL, **_engine_kwargs(DATABASE_URL))
SessionLocal = scoped_session(sessionmaker(bind=engine, autoflush=False, autocommit=False))
Base = declarative_base()


class VedoraLead(Base):
    __tablename__ = "vedora_leads"

    id = Column(Integer, primary_key=True, index=True)
    submission_type = Column(String, nullable=False, index=True)
    first_name = Column(String, nullable=True)
    email = Column(String, nullable=False, index=True)
    city = Column(String, nullable=True, index=True)
    interest_type = Column(String, nullable=True, index=True)
    restaurant_name = Column(String, nullable=True)
    contact_name = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    restaurant_website = Column(String, nullable=True)
    restaurant_type = Column(String, nullable=True)
    message = Column(Text, nullable=True)
    source = Column(String, nullable=True, default="vedora_landing")
    metadata_json = Column(JSON, nullable=True)
    email_sent = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
