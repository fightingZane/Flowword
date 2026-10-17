// responsesRequest 将共享instruction与input包装为Responses请求，model来自用户配置，单次任务不建立远程会话
// 官方协议依据 https://developers.openai.com/api/docs/guides/migrate-to-responses
export function responsesRequest(model: string, instructions: string, input: string) {
  return { model, instructions, input, store: false };
}
// responsesOutputText 从payload提取已完成的assistant文本，不采用reasoning摘要或工具输出，拒绝未完成与拒绝结果
export function responsesOutputText(payload: unknown): string {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Responses 返回结构无效');
  const data = payload as { status?: unknown; error?: unknown; incomplete_details?: unknown; output?: unknown };
  if (data.error || data.incomplete_details || data.status !== undefined && data.status !== 'completed') throw new Error('Responses 未完整完成，请重试或检查模型配置');
  if (!Array.isArray(data.output) || data.output.length > 100) throw new Error('Responses 没有返回有效文本');
  const texts: string[] = [];
  for (const item of data.output) {
    if (!item || item.type !== 'message' || item.role !== 'assistant' || item.phase === 'commentary') continue;
    if (item.status !== undefined && item.status !== 'completed') throw new Error('Responses 消息尚未完整完成');
    if (!Array.isArray(item.content)) throw new Error('Responses 消息内容无效');
    for (const part of item.content) {
      if (part?.type === 'refusal') throw new Error('模型未提供可用结果，请调整选区后重试');
      if (part?.type !== 'output_text') continue;
      if (typeof part.text !== 'string') throw new Error('Responses 文本格式无效');
      texts.push(part.text);
    }
  }
  const text = texts.join('');
  if (!text.trim() || text.length > 20000) throw new Error('Responses 没有返回有效文本');
  return text;
}
