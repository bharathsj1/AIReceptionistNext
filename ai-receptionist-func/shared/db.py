from datetime import datetime
import os
from typing import Generator

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    LargeBinary,
    create_engine,
    inspect,
    text,
    UniqueConstraint,
    Index,
)
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship, scoped_session, sessionmaker

from shared.config import get_database_url

DATABASE_URL = get_database_url()

# Important: DATABASE_URL should be like:
# postgresql+psycopg2://user:pass@host:5432/dbname?sslmode=require&channel_binding=require

def _engine_kwargs(database_url: str) -> dict:
    kwargs = {
        "future": True,
        "pool_pre_ping": True,   # helps with idle connections
    }
    if database_url.startswith("postgresql"):
        timeout = int(os.getenv("DB_CONNECT_TIMEOUT", "10"))
        kwargs["connect_args"] = {"connect_timeout": timeout}
    return kwargs


engine = create_engine(
    DATABASE_URL,
    **_engine_kwargs(DATABASE_URL),
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
    business_category = Column(String, nullable=True)
    business_sub_type = Column(String, nullable=True)
    business_custom_type = Column(String, nullable=True)
    booking_enabled = Column(Boolean, default=False)
    booking_duration_minutes = Column(Integer, nullable=True)
    booking_buffer_minutes = Column(Integer, nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="clients")
    phone_numbers = relationship("PhoneNumber", back_populates="client")


class PromptRegistry(Base):
    __tablename__ = "prompt_registry"

    id = Column(String, primary_key=True, index=True)
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=False, index=True)
    category = Column(String, nullable=True)
    sub_type = Column(String, nullable=False, index=True)
    task_type = Column(String, nullable=True, index=True)
    version = Column(Integer, nullable=False)
    is_active = Column(Boolean, default=False)
    prompt_text = Column(Text, nullable=False)
    prompt_hash = Column(String, nullable=False)
    source_data_hash = Column(String, nullable=False)
    created_by = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class PhoneNumber(Base):
    __tablename__ = "phone_numbers"

    id = Column(Integer, primary_key=True, index=True)
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=False)
    twilio_phone_number = Column(String, nullable=False, unique=True)
    twilio_sid = Column(String, nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    client = relationship("Client", back_populates="phone_numbers")


class Call(Base):
    __tablename__ = "calls"

    id = Column(Integer, primary_key=True, index=True)
    twilio_call_sid = Column(String, unique=True, index=True, nullable=False)
    ultravox_call_id = Column(String, unique=True, index=True, nullable=True)
    ai_phone_number = Column(String, nullable=True, index=True)
    caller_number = Column(String, nullable=True)
    selected_agent_id = Column(String, nullable=True, index=True)
    status = Column(String, nullable=True)
    started_at = Column(DateTime, nullable=True, index=True)
    ended_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Task(Base):
    __tablename__ = "tasks"

    id = Column(String, primary_key=True, index=True)
    client_id = Column(String, nullable=False, index=True)
    call_id = Column(String, nullable=True, index=True)
    twilio_call_sid = Column(String, nullable=True, index=True)
    type = Column(String, nullable=False, index=True)
    status = Column(String, nullable=False, index=True)
    title = Column(String, nullable=False)
    summary = Column(Text, nullable=True)
    details_json = Column(JSON, nullable=True)
    customer_name = Column(String, nullable=True)
    customer_phone = Column(String, nullable=True)
    customer_email = Column(String, nullable=True)
    decision_at = Column(DateTime, nullable=True)
    decision_reason = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class TaskManagerItem(Base):
    __tablename__ = "task_manager_items"

    id = Column(Integer, primary_key=True, index=True)
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    source_type = Column(String, nullable=True, index=True)
    source_id = Column(String, nullable=True, index=True)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    start_time = Column(DateTime, nullable=False, index=True)
    end_time = Column(DateTime, nullable=False, index=True)
    status = Column(String, nullable=False, default="scheduled")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

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
    invoice_sent_at = Column(DateTime, nullable=True)
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
    google_account_email = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User")


class EmailAIEvent(Base):
    __tablename__ = "email_ai_events"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=True, index=True)
    message_id = Column(String, nullable=False, index=True)
    thread_id = Column(String, nullable=True, index=True)
    event_type = Column(String, nullable=False, index=True)
    cached = Column(Boolean, default=False)
    tags_json = Column(JSON, nullable=True)
    priority_label = Column(String, nullable=True)
    sentiment = Column(String, nullable=True)
    action_items_count = Column(Integer, default=0)
    lead_flag = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_email_ai_events_user_type", "user_id", "event_type"),
        Index("ix_email_ai_events_client_type", "client_id", "event_type"),
        Index("ix_email_ai_events_created_at", "created_at"),
    )


class SocialConnection(Base):
    __tablename__ = "social_connections"

    id = Column(Integer, primary_key=True, index=True)
    business_id = Column(Integer, ForeignKey("clients.id"), nullable=False, index=True)
    platform = Column(String, nullable=False, index=True)
    external_account_id = Column(String, nullable=False)
    display_name = Column(String, nullable=True)
    access_token_enc = Column(Text, nullable=False)
    refresh_token_enc = Column(Text, nullable=True)
    token_expires_at = Column(DateTime, nullable=True)
    scopes = Column(Text, nullable=True)
    metadata_json = Column(JSON, nullable=True)
    status = Column(String, nullable=False, default="connected", index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("business_id", "platform", "external_account_id", name="uq_social_connection"),
        Index("ix_social_connection_business_platform", "business_id", "platform"),
    )


class SocialConversation(Base):
    __tablename__ = "social_conversations"

    id = Column(Integer, primary_key=True, index=True)
    business_id = Column(Integer, ForeignKey("clients.id"), nullable=False, index=True)
    platform = Column(String, nullable=False)
    connection_id = Column(Integer, ForeignKey("social_connections.id"), nullable=False, index=True)
    external_conversation_id = Column(String, nullable=False)
    participant_handle = Column(String, nullable=True)
    participant_name = Column(String, nullable=True)
    last_message_text = Column(Text, nullable=True)
    last_message_at = Column(DateTime, nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("platform", "external_conversation_id", name="uq_social_conversation"),
        Index("ix_social_conversation_business_last", "business_id", "last_message_at"),
    )


class SocialMessage(Base):
    __tablename__ = "social_messages"

    id = Column(Integer, primary_key=True, index=True)
    conversation_id = Column(Integer, ForeignKey("social_conversations.id"), nullable=False, index=True)
    platform = Column(String, nullable=False)
    external_message_id = Column(String, nullable=False)
    direction = Column(String, nullable=False)
    sender_type = Column(String, nullable=False)
    text = Column(Text, nullable=True)
    attachments_json = Column(JSON, nullable=True)
    message_ts = Column(DateTime, nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("platform", "external_message_id", name="uq_social_message"),
        Index("ix_social_message_conversation_ts", "conversation_id", "message_ts"),
    )


class SocialPostDraft(Base):
    __tablename__ = "social_post_drafts"

    id = Column(Integer, primary_key=True, index=True)
    business_id = Column(Integer, ForeignKey("clients.id"), nullable=False, index=True)
    caption = Column(Text, nullable=True)
    media_urls_json = Column(JSON, nullable=True)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SocialScheduledPost(Base):
    __tablename__ = "social_scheduled_posts"

    id = Column(Integer, primary_key=True, index=True)
    business_id = Column(Integer, ForeignKey("clients.id"), nullable=False, index=True)
    draft_id = Column(Integer, ForeignKey("social_post_drafts.id"), nullable=False, index=True)
    platform_targets_json = Column(JSON, nullable=False)
    scheduled_for = Column(DateTime, nullable=False, index=True)
    status = Column(String, nullable=False, default="scheduled", index=True)
    external_post_ids_json = Column(JSON, nullable=True)
    last_error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("ix_social_schedule_status_time", "status", "scheduled_for"),
        Index("ix_social_schedule_business_time", "business_id", "scheduled_for"),
    )


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
        if "business_category" not in client_columns:
            conn.execute(text("ALTER TABLE clients ADD COLUMN IF NOT EXISTS business_category VARCHAR"))
        if "business_sub_type" not in client_columns:
            conn.execute(text("ALTER TABLE clients ADD COLUMN IF NOT EXISTS business_sub_type VARCHAR"))
        if "business_custom_type" not in client_columns:
            conn.execute(text("ALTER TABLE clients ADD COLUMN IF NOT EXISTS business_custom_type VARCHAR"))
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
                        google_account_email VARCHAR,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY(user_id) REFERENCES users (id)
                    )
                    """
                )
            )
        else:
            token_columns = {col["name"] for col in inspector.get_columns("google_tokens")}
            if "google_account_email" not in token_columns:
                conn.execute(
                    text("ALTER TABLE google_tokens ADD COLUMN IF NOT EXISTS google_account_email VARCHAR")
                )

        if "email_ai_events" not in existing_tables:
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS email_ai_events (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id INTEGER NOT NULL,
                        client_id INTEGER,
                        message_id VARCHAR NOT NULL,
                        thread_id VARCHAR,
                        event_type VARCHAR NOT NULL,
                        cached BOOLEAN DEFAULT FALSE,
                        tags_json JSONB,
                        priority_label VARCHAR,
                        sentiment VARCHAR,
                        action_items_count INTEGER DEFAULT 0,
                        lead_flag BOOLEAN DEFAULT FALSE,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY(user_id) REFERENCES users (id),
                        FOREIGN KEY(client_id) REFERENCES clients (id)
                    )
                    """
                )
            )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_email_ai_events_user_type "
                "ON email_ai_events (user_id, event_type)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_email_ai_events_client_type "
                "ON email_ai_events (client_id, event_type)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_email_ai_events_message_id "
                "ON email_ai_events (message_id)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_email_ai_events_created_at "
                "ON email_ai_events (created_at DESC)"
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
                        invoice_sent_at TIMESTAMP,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY(subscription_id) REFERENCES subscriptions (id)
                    )
                    """
                )
            )
        else:
            payment_columns = {col["name"] for col in inspector.get_columns("payments")}
            if "invoice_sent_at" not in payment_columns:
                conn.execute(text("ALTER TABLE payments ADD COLUMN IF NOT EXISTS invoice_sent_at TIMESTAMP"))

        if "calls" not in existing_tables:
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS calls (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        twilio_call_sid VARCHAR NOT NULL UNIQUE,
                        ultravox_call_id VARCHAR UNIQUE,
                        ai_phone_number VARCHAR,
                        caller_number VARCHAR,
                        selected_agent_id VARCHAR,
                        status VARCHAR,
                        started_at DATETIME,
                        ended_at DATETIME,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                    """
                )
            )
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_calls_twilio_sid ON calls (twilio_call_sid)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_calls_ultravox_id ON calls (ultravox_call_id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_calls_ai_phone_started ON calls (ai_phone_number, started_at)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_calls_agent_started ON calls (selected_agent_id, started_at)"))
        else:
            call_columns = {col["name"] for col in inspector.get_columns("calls")}
            if "ai_phone_number" not in call_columns:
                conn.execute(text("ALTER TABLE calls ADD COLUMN IF NOT EXISTS ai_phone_number VARCHAR"))
            if "caller_number" not in call_columns:
                conn.execute(text("ALTER TABLE calls ADD COLUMN IF NOT EXISTS caller_number VARCHAR"))
            if "selected_agent_id" not in call_columns:
                conn.execute(text("ALTER TABLE calls ADD COLUMN IF NOT EXISTS selected_agent_id VARCHAR"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_calls_ai_phone_started ON calls (ai_phone_number, started_at)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_calls_agent_started ON calls (selected_agent_id, started_at)"))

        if "tasks" not in existing_tables:
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS tasks (
                        id VARCHAR PRIMARY KEY,
                        client_id VARCHAR NOT NULL,
                        call_id VARCHAR,
                        twilio_call_sid VARCHAR,
                        type VARCHAR NOT NULL,
                        status VARCHAR NOT NULL,
                        title VARCHAR NOT NULL,
                        summary TEXT,
                        details_json JSONB,
                        customer_name VARCHAR,
                        customer_phone VARCHAR,
                        customer_email VARCHAR,
                        decision_at DATETIME,
                        decision_reason TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                    """
                )
            )
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_tasks_client_status ON tasks (client_id, status)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks (created_at DESC)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_tasks_call_id ON tasks (call_id)"))
        else:
            task_columns = {col["name"] for col in inspector.get_columns("tasks")}
            if "decision_reason" not in task_columns:
                conn.execute(text("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS decision_reason TEXT"))
            if "decision_at" not in task_columns:
                conn.execute(text("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS decision_at DATETIME"))
            if "customer_email" not in task_columns:
                conn.execute(text("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS customer_email VARCHAR"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_tasks_client_status ON tasks (client_id, status)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks (created_at DESC)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_tasks_call_id ON tasks (call_id)"))

        if "task_manager_items" not in existing_tables:
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS task_manager_items (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        client_id INTEGER NOT NULL,
                        user_id INTEGER,
                        source_type VARCHAR,
                        source_id VARCHAR,
                        title VARCHAR NOT NULL,
                        description TEXT,
                        start_time DATETIME NOT NULL,
                        end_time DATETIME NOT NULL,
                        status VARCHAR DEFAULT 'scheduled',
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY(client_id) REFERENCES clients (id),
                        FOREIGN KEY(user_id) REFERENCES users (id)
                    )
                    """
                )
            )
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_task_manager_client_start ON task_manager_items (client_id, start_time)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_task_manager_client_end ON task_manager_items (client_id, end_time)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_task_manager_source ON task_manager_items (source_type, source_id)"))

        if "social_connections" not in existing_tables:
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS social_connections (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        business_id INTEGER NOT NULL,
                        platform VARCHAR NOT NULL,
                        external_account_id VARCHAR NOT NULL,
                        display_name VARCHAR,
                        access_token_enc TEXT NOT NULL,
                        refresh_token_enc TEXT,
                        token_expires_at TIMESTAMP,
                        scopes TEXT,
                        metadata_json JSONB,
                        status VARCHAR NOT NULL DEFAULT 'connected',
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY(business_id) REFERENCES clients (id)
                    )
                    """
                )
            )
        if "social_conversations" not in existing_tables:
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS social_conversations (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        business_id INTEGER NOT NULL,
                        platform VARCHAR NOT NULL,
                        connection_id INTEGER NOT NULL,
                        external_conversation_id VARCHAR NOT NULL,
                        participant_handle VARCHAR,
                        participant_name VARCHAR,
                        last_message_text TEXT,
                        last_message_at TIMESTAMP,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY(business_id) REFERENCES clients (id),
                        FOREIGN KEY(connection_id) REFERENCES social_connections (id)
                    )
                    """
                )
            )
        if "social_messages" not in existing_tables:
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS social_messages (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        conversation_id INTEGER NOT NULL,
                        platform VARCHAR NOT NULL,
                        external_message_id VARCHAR NOT NULL,
                        direction VARCHAR NOT NULL,
                        sender_type VARCHAR NOT NULL,
                        text TEXT,
                        attachments_json JSONB,
                        message_ts TIMESTAMP,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY(conversation_id) REFERENCES social_conversations (id)
                    )
                    """
                )
            )
        if "social_post_drafts" not in existing_tables:
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS social_post_drafts (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        business_id INTEGER NOT NULL,
                        caption TEXT,
                        media_urls_json JSONB,
                        created_by_user_id INTEGER NOT NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY(business_id) REFERENCES clients (id),
                        FOREIGN KEY(created_by_user_id) REFERENCES users (id)
                    )
                    """
                )
            )
        if "social_scheduled_posts" not in existing_tables:
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS social_scheduled_posts (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        business_id INTEGER NOT NULL,
                        draft_id INTEGER NOT NULL,
                        platform_targets_json JSONB NOT NULL,
                        scheduled_for TIMESTAMP NOT NULL,
                        status VARCHAR NOT NULL DEFAULT 'scheduled',
                        external_post_ids_json JSONB,
                        last_error TEXT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY(business_id) REFERENCES clients (id),
                        FOREIGN KEY(draft_id) REFERENCES social_post_drafts (id)
                    )
                    """
                )
            )

        conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_social_connection_idx "
                "ON social_connections (business_id, platform, external_account_id)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_social_connection_business_platform "
                "ON social_connections (business_id, platform)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_social_connection_status "
                "ON social_connections (status)"
            )
        )
        conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_social_conversation_idx "
                "ON social_conversations (platform, external_conversation_id)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_social_conversation_business_last "
                "ON social_conversations (business_id, last_message_at DESC)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_social_conversation_connection "
                "ON social_conversations (connection_id)"
            )
        )
        conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_social_message_idx "
                "ON social_messages (platform, external_message_id)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_social_message_conversation_ts "
                "ON social_messages (conversation_id, message_ts ASC)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_social_schedule_status_time "
                "ON social_scheduled_posts (status, scheduled_for ASC)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_social_schedule_business_time "
                "ON social_scheduled_posts (business_id, scheduled_for DESC)"
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
