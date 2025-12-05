from datetime import datetime
from typing import Generator

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    create_engine,
    inspect,
    text,
)
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship, scoped_session, sessionmaker

from shared.config import get_database_url

DATABASE_URL = get_database_url()

# Important: DATABASE_URL should be like:
# postgresql+psycopg2://user:pass@host:5432/dbname?sslmode=require&channel_binding=require

engine = create_engine(
    DATABASE_URL,
    future=True,
    pool_pre_ping=True,   # helps with idle connections
)

SessionLocal = scoped_session(
    sessionmaker(bind=engine, autoflush=False, autocommit=False)
)

Base = declarative_base()


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=False)
    reset_token = Column(String, nullable=True)
    reset_token_expires = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    clients = relationship("Client", back_populates="user")


class Client(Base):
    __tablename__ = "clients"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, nullable=False, index=True)
    website_url = Column(String, nullable=False)
    name = Column(String, nullable=True)
    ultravox_agent_id = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    website_data = Column(Text, nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="clients")
    phone_numbers = relationship("PhoneNumber", back_populates="client")


class PhoneNumber(Base):
    __tablename__ = "phone_numbers"

    id = Column(Integer, primary_key=True, index=True)
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=False)
    twilio_phone_number = Column(String, nullable=False, unique=True)
    twilio_sid = Column(String, nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    client = relationship("Client", back_populates="phone_numbers")


def init_db() -> None:
    """Create tables if they do not exist."""
    Base.metadata.create_all(bind=engine)
    _ensure_optional_columns()


def _ensure_optional_columns() -> None:
    """
    Add optional columns that may not exist in already-deployed databases.
    Safe to run repeatedly; uses conditional ALTER TABLE.
    """
    inspector = inspect(engine)
    with engine.begin() as conn:
        client_columns = {col["name"] for col in inspector.get_columns("clients")}
        if "website_data" not in client_columns:
            conn.execute(text("ALTER TABLE clients ADD COLUMN IF NOT EXISTS website_data TEXT"))
        if "user_id" not in client_columns:
            conn.execute(text("ALTER TABLE clients ADD COLUMN IF NOT EXISTS user_id INTEGER"))


def get_db() -> Generator:
    """Provide a transactional scope around a series of operations."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
