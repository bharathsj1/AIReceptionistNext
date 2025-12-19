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
    LargeBinary,
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


class AITool(Base):
    __tablename__ = "ai_tools"

    id = Column(Integer, primary_key=True, index=True)
    slug = Column(String, unique=True, nullable=False, index=True)
    name = Column(String, nullable=True)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=False)
    reset_token = Column(String, nullable=True)
    reset_token_expires = Column(DateTime, nullable=True)
    is_admin = Column(Boolean, default=False)
    business_name = Column(String, nullable=True)
    business_number = Column(String, nullable=True)
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
    business_name = Column(String, nullable=True)
    business_phone = Column(String, nullable=True)
    booking_enabled = Column(Boolean, default=False)
    booking_duration_minutes = Column(Integer, nullable=True)
    booking_buffer_minutes = Column(Integer, nullable=True)
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


class Subscription(Base):
    __tablename__ = "subscriptions"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, nullable=False, index=True)
    tool = Column(String, nullable=True, index=True, default="ai_receptionist")
    tool_id = Column(Integer, ForeignKey("ai_tools.id"), nullable=True, index=True)
    plan_id = Column(String, nullable=False)
    price_id = Column(String, nullable=True)
    stripe_customer_id = Column(String, nullable=False)
    stripe_subscription_id = Column(String, nullable=False, unique=True, index=True)
    status = Column(String, nullable=False)
    current_period_end = Column(DateTime, nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    payments = relationship("Payment", back_populates="subscription")
    user = relationship("User")
    tool_rel = relationship("AITool")


class Payment(Base):
    __tablename__ = "payments"

    id = Column(Integer, primary_key=True, index=True)
    subscription_id = Column(Integer, ForeignKey("subscriptions.id"), nullable=False)
    stripe_invoice_id = Column(String, nullable=True, index=True)
    stripe_payment_intent_id = Column(String, nullable=True, index=True)
    amount = Column(Integer, nullable=False)
    currency = Column(String, nullable=False, default="usd")
    status = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    subscription = relationship("Subscription", back_populates="payments")


class GoogleToken(Base):
    """
    Stores OAuth tokens for Google access.
    """

    __tablename__ = "google_tokens"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    access_token = Column(Text, nullable=False)
    refresh_token = Column(Text, nullable=True)
    scope = Column(Text, nullable=True)
    token_type = Column(String, nullable=True)
    expires_at = Column(DateTime, nullable=True)
    id_token = Column(LargeBinary, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User")


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
        if "ai_tools" not in inspector.get_table_names():
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS ai_tools (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        slug VARCHAR NOT NULL UNIQUE,
                        name VARCHAR,
                        description TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                    """
                )
            )

        client_columns = {col["name"] for col in inspector.get_columns("clients")}
        if "website_data" not in client_columns:
            conn.execute(text("ALTER TABLE clients ADD COLUMN IF NOT EXISTS website_data TEXT"))
        if "user_id" not in client_columns:
            conn.execute(text("ALTER TABLE clients ADD COLUMN IF NOT EXISTS user_id INTEGER"))
        if "business_name" not in client_columns:
            conn.execute(text("ALTER TABLE clients ADD COLUMN IF NOT EXISTS business_name VARCHAR"))
        if "business_phone" not in client_columns:
            conn.execute(text("ALTER TABLE clients ADD COLUMN IF NOT EXISTS business_phone VARCHAR"))
        if "booking_enabled" not in client_columns:
            conn.execute(text("ALTER TABLE clients ADD COLUMN IF NOT EXISTS booking_enabled BOOLEAN DEFAULT FALSE"))
        if "booking_duration_minutes" not in client_columns:
            conn.execute(text("ALTER TABLE clients ADD COLUMN IF NOT EXISTS booking_duration_minutes INTEGER"))
        if "booking_buffer_minutes" not in client_columns:
            conn.execute(text("ALTER TABLE clients ADD COLUMN IF NOT EXISTS booking_buffer_minutes INTEGER"))

        user_columns = {col["name"] for col in inspector.get_columns("users")}
        if "is_admin" not in user_columns:
            conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE"))
        if "business_name" not in user_columns:
            conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS business_name VARCHAR"))
        if "business_number" not in user_columns:
            conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS business_number VARCHAR"))

        existing_tables = inspector.get_table_names()
        if "google_tokens" not in existing_tables:
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS google_tokens (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id INTEGER NOT NULL,
                        access_token TEXT NOT NULL,
                        refresh_token TEXT,
                        scope TEXT,
                        token_type VARCHAR,
                        expires_at DATETIME,
                        id_token BLOB,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY(user_id) REFERENCES users (id)
                    )
                    """
                )
            )

        if "subscriptions" not in existing_tables:
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS subscriptions (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        email VARCHAR NOT NULL,
                        tool VARCHAR DEFAULT 'ai_receptionist',
                        tool_id INTEGER,
                        plan_id VARCHAR NOT NULL,
                        price_id VARCHAR,
                        user_id INTEGER,
                        stripe_customer_id VARCHAR NOT NULL,
                        stripe_subscription_id VARCHAR NOT NULL UNIQUE,
                        status VARCHAR NOT NULL,
                        current_period_end DATETIME,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY(user_id) REFERENCES users (id)
                    )
                    """
                )
            )
        else:
            sub_columns = {col["name"] for col in inspector.get_columns("subscriptions")}
            if "price_id" not in sub_columns:
                conn.execute(
                    text("ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS price_id VARCHAR")
                )
            if "tool" not in sub_columns:
                conn.execute(
                    text(
                        "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS tool VARCHAR DEFAULT 'ai_receptionist'"
                    )
                )
            if "tool_id" not in sub_columns:
                conn.execute(
                    text(
                        "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS tool_id INTEGER REFERENCES ai_tools(id)"
                    )
                )
            if "user_id" not in sub_columns:
                conn.execute(
                    text("ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id)")
                )

        if "payments" not in existing_tables:
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS payments (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        subscription_id INTEGER NOT NULL,
                        stripe_invoice_id VARCHAR,
                        stripe_payment_intent_id VARCHAR,
                        amount INTEGER NOT NULL,
                        currency VARCHAR NOT NULL DEFAULT 'usd',
                        status VARCHAR NOT NULL,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY(subscription_id) REFERENCES subscriptions (id)
                    )
                    """
                )
            )

        # Seed default tools and backfill tool_id where missing.
        default_tools = [
            ("ai_receptionist", "AI Receptionist"),
            ("email_manager", "Email Manager"),
            ("social_media_manager", "Social Media Manager"),
        ]
        for slug, name in default_tools:
            conn.execute(
                text(
                    """
                    INSERT INTO ai_tools (slug, name)
                    VALUES (:slug, :name)
                    ON CONFLICT (slug) DO NOTHING
                    """
                ),
                {"slug": slug, "name": name},
            )

        sub_columns = {col["name"] for col in inspector.get_columns("subscriptions")}
        if "tool_id" in sub_columns:
            conn.execute(
                text(
                    """
                    UPDATE subscriptions
                    SET tool_id = (
                        SELECT id FROM ai_tools WHERE slug = subscriptions.tool LIMIT 1
                    )
                    WHERE tool_id IS NULL AND tool IS NOT NULL
                    """
                )
            )


def get_db() -> Generator:
    """Provide a transactional scope around a series of operations."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
