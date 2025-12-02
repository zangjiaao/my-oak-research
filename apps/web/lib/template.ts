/**
 * 模板变量替换工具
 * 支持在模板中使用 {{variable}} 格式的变量占位符
 */

export interface TemplateVariables {
  title?: string;
  summary?: string;
  markdown?: string;
  [key: string]: string | undefined;
}

/**
 * 支持的模板变量列表
 */
export const TEMPLATE_VARIABLES = {
  title: "报告标题",
  summary: "报告摘要",
  markdown: "报告正文（Markdown 格式）",
} as const;

/**
 * 替换模板中的变量占位符
 * @param template 模板内容
 * @param variables 变量值映射
 * @returns 替换后的内容
 */
export function renderTemplate(
  template: string,
  variables: TemplateVariables
): string {
  let result = template;

  // 替换所有 {{variable}} 格式的占位符
  result = result.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const value = variables[key];
    return value !== undefined ? String(value) : match;
  });

  return result;
}

/**
 * 提取模板中使用的变量名
 * @param template 模板内容
 * @returns 变量名数组
 */
export function extractTemplateVariables(template: string): string[] {
  const matches = template.match(/\{\{(\w+)\}\}/g);
  if (!matches) return [];

  const variables = new Set<string>();
  matches.forEach((match) => {
    const varName = match.replace(/\{\{|\}\}/g, "");
    variables.add(varName);
  });

  return Array.from(variables);
}
