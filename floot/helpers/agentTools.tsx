// Tool catalog. AGENT_TOOLS is the Anthropic-style source of truth; AGENT_TOOLS_OPENAI
// maps to the OpenAI function shape.
//
// SECURITY: run_sql below is full read/write DB access — acceptable ONLY for an
// INTERNAL single-trusted-owner agent. For an EXTERNAL-facing agent, REMOVE run_sql
// and replace it with narrow, validated, allow-listed tools.
export const AGENT_TOOLS = [
  {
    name: "run_sql",
    description:
      "(INTERNAL agents ONLY) Execute a SQL query against the database. Create tables or query any data. snake_case names. Do NOT use for the agent_memories table — use the dedicated memory tools.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The SQL query to execute" },
        explanation: { type: "string", description: "Brief explanation of what this query does" },
      },
      required: ["query"],
    },
  },
  {
    name: "create_memory",
    description: "Create a new memory. Optionally pass parent_id for a child memory. Returns the new memory's ID.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        content: { type: "string" },
        parent_id: { type: "number", description: "Optional parent memory ID" },
      },
      required: ["title", "content"],
    },
  },
  {
    name: "read_memory",
    description: "Read a memory by ID. Returns its title, content, and a list of child memory IDs and titles.",
    input_schema: { type: "object", properties: { id: { type: "number" } }, required: ["id"] },
  },
  {
    name: "update_memory",
    description: "Update a memory's title and/or content by ID.",
    input_schema: {
      type: "object",
      properties: { id: { type: "number" }, title: { type: "string" }, content: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "delete_memory",
    description: "Delete a memory by ID. Child memories are deleted automatically (DB cascade).",
    input_schema: { type: "object", properties: { id: { type: "number" } }, required: ["id"] },
  },
  {
    name: "search_memories",
    description: "Search your memories by keyword across titles and content — use it to find a memory or check whether one already exists before creating a duplicate. Keyword/substring match (not semantic). Returns matching memories: id, title, parent_memory_id, and a content snippet.",
    input_schema: { type: "object", properties: { query: { type: "string", description: "Keyword or phrase to match in a memory's title or content." } }, required: ["query"] },
  },
  {
    name: "move_memory",
    description: "Reparent a memory to reorganize the tree. Pass parent_id to nest it under another memory, or null (or omit) to promote it to a top-level index memory.",
    input_schema: { type: "object", properties: { id: { type: "number" }, parent_id: { type: "number", description: "New parent memory id; null or omit to make it top-level." } }, required: ["id"] },
  },
  {
    name: "update_standing_instructions",
    description:
      "Update standing instructions — permanent behavioral rules always in context. Global applies everywhere; per-thread overrides global. Empty content clears.",
    input_schema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Instruction text (max 4000 chars). Empty string clears." },
        thread_id: { type: "number", description: "Optional per-thread override. Omit for global." },
      },
      required: ["content"],
    },
  },
  {
    name: "send_message_to_thread",
    description:
      "Send a message to another of your threads (by thread_id, or thread_name to match by title). With trigger_processing true (default) the target thread wakes and acts on it — e.g. kick off a recurring job's dedicated thread immediately. Set trigger_processing false to just leave a visible note without waking it.",
    input_schema: {
      type: "object",
      properties: {
        thread_id: { type: "number", description: "Target thread id (preferred); use list_threads to find it." },
        thread_name: { type: "string", description: "Match the target thread by title (used when thread_id is omitted)." },
        message: { type: "string" },
        trigger_processing: { type: "boolean", description: "Default true: wake the target thread. False: deliver without processing." },
      },
      required: ["message"],
    },
  },
  {
    name: "list_threads",
    description:
      "List your threads so you can target one with send_message_to_thread. Each thread returns id, title, status, is_main_thread, and a derived type: regular, remote_agent (a paired remote peer's thread — also gives remote_agent_name), telegram, or recurring. Optional filter matches the title.",
    input_schema: {
      type: "object",
      properties: { filter: { type: "string", description: "Optional title substring filter." } },
      required: [],
    },
  },
  {
    name: "view_image",
    description:
      "Look at an image by URL and get a text description back. Your main model (glm-5) is text-only, so this routes the image to a vision model (glm-5-flash). Pass a specific instruction about what to look for.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL of the image to view." },
        instruction: { type: "string", description: "What to look for or describe (e.g. read the text, describe the chart)." },
      },
      required: ["url", "instruction"],
    },
  },
  {
    name: "view_pdf",
    description:
      "Read a PDF document by URL and get its text/answer back. Your main model (glm-5) is text-only and can't read documents, so this routes the PDF to a document-capable model (gpt-6-luna). Pass a specific instruction about what to extract or answer.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL of the PDF to read." },
        instruction: { type: "string", description: "What to extract or answer (e.g. summarize it, pull the invoice total, list the section headers)." },
      },
      required: ["url", "instruction"],
    },
  },
];

export const AGENT_TOOLS_OPENAI = AGENT_TOOLS.map((tool) => ({
  type: "function" as const,
  function: { name: tool.name, description: tool.description, parameters: tool.input_schema },
}));

// No web search is shipped by default — glm-5 has no hosted web search. To add it,
// define a `web_search` function tool here backed by gpt-6-luna + OpenAI's hosted
// web_search tool and add a matching executor branch in agentToolExecutor
// (load floot-ai-chat-luna for the exact call shape + citation extraction).
