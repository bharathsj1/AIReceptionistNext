from typing import Any, Dict, Optional, Tuple

from shared.prompt_registry import compute_prompt_hash, create_prompt_version, get_active_prompt
from services.prompt_generation_service import (
    build_openai_prompt_request,
    call_openai_for_prompt,
    prepare_prompt_inputs,
    normalize_task_type,
    infer_task_type,
)


def generate_prompt_record(
    db,
    *,
    client_id: int,
    category: Optional[str],
    sub_type: str,
    task_type: Optional[str],
    business_profile: Optional[Dict[str, Any]],
    knowledge_text: Optional[str],
    created_by: Optional[str] = None,
) -> Tuple[Optional[object], bool]:
    normalized_task, normalized_profile, normalized_knowledge, source_hash = prepare_prompt_inputs(
        category=category,
        sub_type=sub_type,
        task_type=task_type,
        business_profile=business_profile,
        knowledge_text=knowledge_text,
    )

    active = get_active_prompt(db, client_id, sub_type, normalized_task)
    if active and active.source_data_hash == source_hash:
        return active, False

    openai_payload = build_openai_prompt_request(
        category=category,
        sub_type=sub_type,
        task_type=normalized_task,
        business_profile=normalized_profile,
        knowledge_text=normalized_knowledge,
    )
    prompt_text = call_openai_for_prompt(openai_payload)
    prompt_hash = compute_prompt_hash(prompt_text)

    if active and active.prompt_hash == prompt_hash:
        active.source_data_hash = source_hash
        active.is_active = True
        return active, True

    record = create_prompt_version(
        db,
        client_id=client_id,
        category=category,
        sub_type=sub_type,
        task_type=normalized_task,
        prompt_text=prompt_text,
        prompt_hash=prompt_hash,
        source_data_hash=source_hash,
        created_by=created_by,
    )
    return record, True


def resolve_prompt_for_call(
    db,
    *,
    client_id: int,
    category: Optional[str],
    sub_type: Optional[str],
    task_type: Optional[str] = None,
):
    normalized_task = normalize_task_type(task_type) or infer_task_type(category, sub_type)
    if not sub_type:
        return None
    return get_active_prompt(db, client_id, sub_type, normalized_task)
