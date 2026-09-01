import React, { useState, useMemo, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import { Copy, Check, FileCode, ShieldCheck } from 'lucide-react'
import Prism from 'prismjs'

// Import core syntax languages for developer tools
import 'prismjs/components/prism-typescript'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-jsx'
import 'prismjs/components/prism-tsx'
import 'prismjs/components/prism-rust'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-yaml'
import 'prismjs/components/prism-toml'
import 'prismjs/components/prism-markdown'
import 'prismjs/components/prism-diff'
import 'prismjs/components/prism-sql'
import 'prismjs/components/prism-go'

interface MarkdownViewProps {
  content: string
  className?: string
  isLive?: boolean
}

function CodeBlock({ children, className, ...props }: { children?: React.ReactNode; className?: string }) {
  const [copied, setCopied] = useState(false)
  const match = /language-(\w+)/.exec(className || '')
  const language = match ? match[1].toLowerCase() : ''
  const rawCode = String(children || '').replace(/\n$/, '')

  // Check if this is an ACCP proposal envelope (JSON / ACCP block)
  const accpData = useMemo(() => {
    if (language === 'accp' || language === 'json') {
      try {
        const parsed = JSON.parse(rawCode)
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
          return {
            family,
            kind,
            capability: payload.capability || payload.tool_name || payload.tool || payload.name || '',
            target: payload.target || payload.file_path || payload.path || payload.file || '',
            intent: payload.intent || payload.rationale || payload.description || '',
            summary: payload.summary || '',
            hypotheses: Array.isArray(payload.add) ? payload.add : [],
            revision: parsed.revision,
          }
        }
      } catch {
        // Fall back to regular code block without crashing during stream
      }
    }
    return null
  }, [language, rawCode])

  const copyToClipboard = () => {
    void navigator.clipboard.writeText(rawCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  // Highlight syntax using Prism
  const highlightedHtml = useMemo(() => {
    if (!language || !Prism.languages[language]) {
      // Fallback aliases
      const aliasMap: Record<string, string> = {
        rs: 'rust',
        py: 'python',
        ts: 'typescript',
        js: 'javascript',
        sh: 'bash',
        zsh: 'bash',
        yml: 'yaml',
      }
      const mapped = aliasMap[language]
      if (mapped && Prism.languages[mapped]) {
        return Prism.highlight(rawCode, Prism.languages[mapped], mapped)
      }
      return null
    }
    return Prism.highlight(rawCode, Prism.languages[language], language)
  }, [language, rawCode])

  if (accpData) {
    return (
      <div className="accp-card">
        <div className="accp-card-header">
          <div className="accp-header-left">
            <ShieldCheck size={14} className="accp-icon" />
            <span className="accp-badge">{accpData.family} / {accpData.kind}</span>
            {accpData.capability && <span className="accp-cap">{accpData.capability}</span>}
          </div>
          {accpData.revision !== undefined && <span className="accp-rev">r{accpData.revision}</span>}
        </div>
        <div className="accp-card-body">
          {accpData.target && (
            <div className="accp-row">
              <span className="accp-key">TARGET</span>
              <code className="accp-val-target">{accpData.target}</code>
            </div>
          )}
          {accpData.intent && (
            <div className="accp-row">
              <span className="accp-key">INTENT</span>
              <span className="accp-val-intent">{accpData.intent}</span>
            </div>
          )}
          {accpData.summary && (
            <div className="accp-row">
              <span className="accp-key">SUMMARY</span>
              <span className="accp-val-summary">{accpData.summary}</span>
            </div>
          )}
          {accpData.hypotheses.length > 0 && (
            <div className="accp-row">
              <span className="accp-key">HYPOTHESES</span>
              <ul className="accp-hypo-list">
                {accpData.hypotheses.map((h: string, idx: number) => (
                  <li key={idx}>+ {h}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    )
  }

  // Inline code vs multi-line code block
  const isInline = !className && !rawCode.includes('\n')
  if (isInline) {
    return <code className="inline-code" {...props}>{children}</code>
  }

  return (
    <div className="code-block-wrapper">
      <div className="code-block-header">
        <div className="code-block-lang">
          <FileCode size={13} />
          <span>{language || 'text'}</span>
        </div>
        <button
          type="button"
          className="code-copy-button"
          onClick={copyToClipboard}
          title={copied ? 'Copied' : 'Copy code'}
        >
          {copied ? <Check size={13} className="text-good" /> : <Copy size={13} />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre className="code-block-pre">
        {highlightedHtml ? (
          <code
            className={`prism-code language-${language}`}
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          />
        ) : (
          <code className={className} {...props}>
            {children}
          </code>
        )}
      </pre>
    </div>
  )
}

export function MarkdownView({ content, className = '', isLive = false }: MarkdownViewProps) {
  const cleanContent = useMemo(() => {
    if (!content) return ''
    let text = content

    // Strip unclosed/closed think tags
    text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
    if (text.includes('<think>')) {
      const idx = text.indexOf('<think>')
      text = text.slice(0, idx).trim()
    }

    return text
  }, [content])

  if (!cleanContent.trim()) {
    return null
  }

  return (
    <div className={`markdown-view ${isLive ? 'live-streaming' : ''} ${className}`}>
      <div className="markdown-render-wrapper">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw]}
          components={{
            code: CodeBlock,
            p: ({ children }) => <p className="md-p">{children}</p>,
            h1: ({ children }) => <h1 className="md-h1">{children}</h1>,
            h2: ({ children }) => <h2 className="md-h2">{children}</h2>,
            h3: ({ children }) => <h3 className="md-h3">{children}</h3>,
            h4: ({ children }) => <h4 className="md-h4">{children}</h4>,
            ul: ({ children }) => <ul className="md-ul">{children}</ul>,
            ol: ({ children }) => <ol className="md-ol">{children}</ol>,
            li: ({ children }) => <li className="md-li">{children}</li>,
            blockquote: ({ children }) => <blockquote className="md-blockquote">{children}</blockquote>,
            table: ({ children }) => <div className="table-container"><table className="md-table">{children}</table></div>,
            a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="md-link">{children}</a>,
          }}
        >
          {cleanContent}
        </ReactMarkdown>
        {isLive && <span className="stream-cursor-pulse" aria-hidden="true" />}
      </div>
    </div>
  )
}
