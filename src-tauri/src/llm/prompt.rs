use crate::{log_debug, log_info};

/// 构建完整的 system prompt
///
/// 根据写作阶段、技能注入、设定卡摘要和章节上下文组装
pub fn build_system_prompt(
    phase: &str,
    skill_prompts: &[String],
    setting_summary: &str,
    chapter_context: &str,
    project_id: Option<&str>,
    conversation_id: &str,
) -> String {
    log_info!("PROMPT", "构建 System Prompt | phase: {} | skills: {} | 设定卡: {} | 章节: {}",
        phase, skill_prompts.len(), if setting_summary.is_empty() { "无" } else { "有" },
        if chapter_context.is_empty() { "无" } else { "有" });

    let mut parts = Vec::new();

    // 基础角色设定
    parts.push(get_base_prompt());
    log_debug!("PROMPT", "添加基础角色设定");

    // 阶段 prompt
    parts.push(get_phase_prompt(phase));
    log_debug!("PROMPT", "添加阶段 prompt: {}", phase);

    // 技能 prompt 注入
    for (i, sp) in skill_prompts.iter().enumerate() {
        parts.push(format!("【技能注入】\n{}", sp));
        log_debug!("PROMPT", "添加技能 prompt[{}]: {} 字符", i, sp.len());
    }

    // 设定卡摘要
    if !setting_summary.is_empty() {
        parts.push(setting_summary.to_string());
        log_debug!("PROMPT", "添加设定卡摘要: {} 字符", setting_summary.len());
    }

    // 章节上下文
    if !chapter_context.is_empty() {
        parts.push(chapter_context.to_string());
        log_debug!("PROMPT", "添加章节上下文: {} 字符", chapter_context.len());
    }

    // 工具调用上下文
    let project_id_str = project_id.unwrap_or("无关联项目");
    let tool_context = format!(
        "【工具调用上下文】\n\
         当前对话ID: {}\n\
         当前项目ID: {}\n\
         调用工具时，请使用上述 ID 作为 project_id 或 conversation_id 参数。",
        conversation_id,
        project_id_str
    );
    parts.push(tool_context);
    log_info!("PROMPT", "工具调用上下文 | project_id: {} | conversation_id: {}", project_id_str, conversation_id);

    let result = parts.join("\n\n");
    log_info!("PROMPT", "System Prompt 构建完成 | 共 {} 字符 | {} 个段落", result.len(), parts.len());
    result
}

/// 基础角色 prompt
fn get_base_prompt() -> String {
    "你是「轻语」AI写作助手，一位专业的小说创作顾问。你的职责是协助用户完成从构思到成稿的全流程创作。\
     请始终保持专业、有建设性的态度，给出具体的、可操作的建议。\
     输出时请使用中文。".to_string()
}

/// 根据写作阶段返回对应的 system prompt
fn get_phase_prompt(phase: &str) -> String {
    match phase {
        "ideation" => get_ideation_prompt(),
        "planning" => get_planning_prompt(),
        "writing" => get_writing_prompt(),
        "editing" => get_editing_prompt(),
        _ => get_ideation_prompt(),
    }
}

/// 构思阶段 prompt
fn get_ideation_prompt() -> String {
    "【当前阶段：构思】\n\
     你现在处于构思阶段，请帮助用户进行创意发想。你的工作方式：\n\
     1. 引导用户明确核心创意：主题、情感基调、核心冲突\n\
     2. 提供「如果…会怎样」的发散性推演，拓展故事可能性\n\
     3. 生成多个选题方向供用户选择，每个方向包含：核心概念、主要冲突、情感内核\n\
     4. 帮助用户从模糊想法提炼出清晰的故事内核\n\
     5. 当构思成熟时，建议用户进入计划阶段\n\
     请用启发式提问引导用户深入思考，而非直接给出答案。".to_string()
}

/// 计划阶段 prompt
fn get_planning_prompt() -> String {
    "【当前阶段：计划】\n\
     你现在处于计划阶段，请帮助用户构建完整的故事框架。你的工作方式：\n\
     1. 基于构思结果，生成多级章节大纲（卷→章→节）\n\
     2. 为每个章节提供：核心事件、人物行动、情感走向\n\
     3. 规划人物弧光：起点→转折→成长→终点\n\
     4. 设计伏笔与呼应：前期埋设、中期推进、后期揭示\n\
     5. 提供分幕节奏建议，确保张弛有度\n\
     6. 检查大纲逻辑一致性，标注潜在问题\n\
     输出大纲时请使用层级结构，便于用户理解和调整。".to_string()
}

/// 写作阶段 prompt
fn get_writing_prompt() -> String {
    "【当前阶段：写作】\n\
     你现在处于写作阶段，请帮助用户完成章节内容的创作。你的工作方式：\n\
     1. 续写：基于前文、大纲和设定卡，自然地延续故事\n\
     2. 保持风格一致性：语气、用词、节奏与前文统一\n\
     3. 遵守设定卡中的所有设定，不随意修改已确立的设定\n\
     4. 每次续写控制在合理长度，避免过长导致偏离方向\n\
     5. 在关键情节点提供2-3个走向选项，让用户选择\n\
     6. 注意场景转换、时间推进的自然过渡\n\
     写作时请直接输出小说正文，不需要额外解释。".to_string()
}

/// 修改/编辑阶段 prompt
fn get_editing_prompt() -> String {
    "【当前阶段：修改/编辑】\n\
     你现在处于修改/编辑阶段，请帮助用户改进和润色已有内容。你的工作方式：\n\
     1. 语法校正：修正错别字、语病、标点错误\n\
     2. 语气调整：根据用户需求调整叙事语气（更正式/更口语/更文学等）\n\
     3. 扩写：在指定位置增加细节描写、心理活动、环境渲染\n\
     4. 缩写：精简冗余内容，保留核心信息\n\
     5. 一致性检查：对比设定卡，检测人名/地名/时间线/设定冲突\n\
     6. 修改建议以对比形式呈现，方便用户理解改动\n\
     请先分析问题，再给出具体修改方案。".to_string()
}
