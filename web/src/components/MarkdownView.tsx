import { useMemo, useState } from 'react'
import { marked, Renderer } from 'marked'

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// Custom marked renderer for ACCP Proposal cards and enhanced code blocks
const customRenderer = new Renderer()

customRenderer.code = function ({ text, lang }: { text: string; lang?: string }) {
  const cleanLang = (lang || '').trim().toLowerCase()

  // Intercept ```accp or ```json containing ACCP envelopes
  if (cleanLang.startsWith('accp') || cleanLang === 'json') {
    try {
      const parsed = JSON.parse(text)
      const isAccp =
        parsed.accp_version ||
        parsed.family ||
        parsed.action_type ||
        parsed.kind ||
        (parsed.payload && (parsed.payload.capability || parsed.payload.tool || parsed.payload.add))

      if (isAccp) {
        const family = (parsed.family || 'PROPOSAL').toUpperCase()
        const kind = (parsed.kind || parsed.action_type || 'ACTION').toUpperCase()
        const payload = parsed.payload || parsed

        const cap = payload.capability || payload.tool_name || payload.tool || payload.name || ''
        const target = payload.target || payload.file_path || payload.path || payload.file || ''
        const intent = payload.intent || payload.rationale || payload.description || ''
        const summary = payload.summary || ''
        const addHypotheses = Array.isArray(payload.add) ? payload.add : []

        return `
<div class="accp-card" role="region" aria-label="ACCP Action Proposal">
  <div class="accp-card-header">
    <span class="accp-badge">${escapeHtml(family)} / ${escapeHtml(kind)}</span>
    ${cap ? `<span class="accp-cap">${escapeHtml(cap)}</span>` : ''}
    ${parsed.revision !== undefined ? `<span class="accp-rev">r${parsed.revision}</span>` : ''}
  </div>
  <div class="accp-card-body">
    ${target ? `<div class="accp-row"><span class="accp-key">TARGET</span><code class="accp-val-target">${escapeHtml(target)}</code></div>` : ''}
    ${intent ? `<div class="accp-row"><span class="accp-key">INTENT</span><span class="accp-val-intent">${escapeHtml(intent)}</span></div>` : ''}
    ${summary ? `<div class="accp-row"><span class="accp-key">SUMMARY</span><span class="accp-val-summary">${escapeHtml(summary)}</span></div>` : ''}
    ${addHypotheses.length > 0 ? `<div class="accp-row"><span class="accp-key">HYPOTHESES</span><ul class="accp-hypo-list">${addHypotheses.map((h: string) => `<li>+ ${escapeHtml(h)}</li>`).join('')}</ul></div>` : ''}
  </div>
</div>`
      }
    } catch {
      // Fall through to standard code block
    }
  }

  const langBadge = cleanLang ? `<div class="code-badge">${escapeHtml(cleanLang.toUpperCase())}</div>` : ''
  return `
<div class="code-block-wrapper">
  ${langBadge}
  <pre><code class="language-${escapeHtml(cleanLang)}">${escapeHtml(text)}</code></pre>
</div>`
}

marked.setOptions({
  gfm: true,
  breaks: true,
  renderer: customRenderer,
})

interface MarkdownViewProps {
  content: string
  className?: string
}

function normalizeRawAccpBlocks(text: string): string {
  // If JSON is already fenced, don't double fence
  const parts = text.split('```')
  for (let i = 0; i < parts.length; i += 2) {
    // Unfenced part
    parts[i] = parts[i].replace(/(\{(?:[^{}]|(?:\{[^{}]*\}))*"accp_version"[^{}]*\})/g, (match) => {
      try {
        JSON.parse(match.trim())
        return `\n\`\`\`accp\n${match.trim()}\n\`\`\`\n`
      } catch {
        return match
      }
    })
  }
  return parts.join('```')
}

export function MarkdownView({ content, className = '' }: MarkdownViewProps) {
  // Check for <think>...</think> blocks
  const { thinking, mainContent } = useMemo(() => {
    let thinking: string | null = null
    let main = content

    const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/i)
    if (thinkMatch) {
      thinking = thinkMatch[1].trim()
      main = content.replace(/<think>[\s\S]*?<\/think>/i, '').trim()
    } else if (content.startsWith('<think>')) {
      thinking = content.replace('<think>', '').trim()
      main = ''
    }

    return { thinking, mainContent: normalizeRawAccpBlocks(main) }
  }, [content])

  const html = useMemo(() => {
    if (!mainContent) return ''
    try {
      return marked.parse(mainContent) as string
    } catch {
      return escapeHtml(mainContent)
    }
  }, [mainContent])

  return (
    <div className={`markdown-view ${className}`}>
      {thinking && <ThinkingAccordion text={thinking} />}
      {html ? (
        <div
          className="markdown-body"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : null}
    </div>
  )
}

function ThinkingAccordion({ text }: { text: string }) {
  const [open, setOpen] = useState(false)

  return (
    <div className={`thinking-block ${open ? 'open' : ''}`}>
      <button
        type="button"
        className="thinking-summary"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        style={{ width: '100%', background: 'transparent', border: 0 }}
      >
        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <circle cx="8" cy="8" r="6" />
          <path d="M8 5v3l2 2" />
        </svg>
        <span className="thinking-label">
          {open ? 'Hide reasoning process' : 'View reasoning process'}
        </span>
        <span className="thinking-toggle-arrow" aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="thinking-content">
          <pre style={{ margin: 0, background: 'transparent', border: 0, padding: 0 }}>{text}</pre>
        </div>
      )}
    </div>
  )
}
