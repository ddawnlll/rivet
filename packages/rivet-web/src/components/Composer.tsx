import React, { useEffect, useMemo, useRef, useState } from 'react'
import Fuse from 'fuse.js'
import type { Attachment, Census, ConnectionState, Diff } from '../types'
import { useSessionStore } from '../store/useSessionStore'

type Props = {
  value: string
  attachments: Attachment[]
  runActive: boolean
  connection: ConnectionState
  revision?: string | null
  census?: Census | null
  diff?: Diff | null
  onChange: (value: string) => void
  onAttachments: (attachments: Attachment[]) => void
  onSend: (attachments: Attachment[]) => void
  onCancel: () => void
  onRemoveAttachment: (name: string) => void
}

export function Composer({
  value,
  attachments,
  runActive,
  connection,
  revision,
  census,
  diff,
  onChange,
  onAttachments,
  onSend,
  onCancel,
  onRemoveAttachment,
}: Props) {
  const input = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [mentionActive, setMentionActive] = useState(false)
  const [mentionFilter, setMentionFilter] = useState('')
  const [highlightIndex, setHighlightIndex] = useState(0)

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(180, Math.max(52, textarea.scrollHeight))}px`
  }, [value])

  // Trigger census loading if empty
  useEffect(() => {
    if (!census) {
      void useSessionStore.getState().loadCensus(false)
    }
  }, [census])

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (value.trim().length > 0) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [value])

  // Aggregate candidate paths from census, diff, and standard project locations
  const allPaths = useMemo(() => {
    const set = new Set<string>()
    if (census?.directories) {
      for (const d of census.directories) {
        if (d.relative_path) set.add(d.relative_path)
      }
    }
    if (diff?.files) {
      for (const f of diff.files) {
        if (f) set.add(f)
      }
    }
    // Fallback baseline paths if census is not fully populated yet
    const fallback = [
      'Cargo.toml',
      'package.json',
      'README.md',
      'docs/rivet-gui-design-spec-v1.0.html',
      'crates/rivet',
      'crates/rivet-api',
      'crates/rivet-service',
      'crates/noesis',
      'crates/praxis',
      'crates/accp',
      'crates/hephaestus',
      'web/src/App.tsx',
      'web/src/styles.css',
    ]
    for (const p of fallback) {
      set.add(p)
    }
    return Array.from(set)
  }, [census, diff])

  // Fuse.js fuzzy index
  const fuse = useMemo(() => {
    return new Fuse(allPaths, {
      threshold: 0.5,
      distance: 120,
      minMatchCharLength: 1,
      shouldSort: true,
    })
  }, [allPaths])

  const candidateFiles = useMemo(() => {
    if (!mentionFilter.trim()) {
      return allPaths.slice(0, 10)
    }
    const results = fuse.search(mentionFilter)
    return results.slice(0, 10).map(r => r.item)
  }, [allPaths, fuse, mentionFilter])

  const submit = () => {
    const trimmed = value.trim()
    if (trimmed) {
      onSend(attachments)
    }
  }

  const handleMentionSelect = (file: string) => {
    const textarea = textareaRef.current
    const cursor = textarea?.selectionStart ?? value.length
    const textBeforeCursor = value.slice(0, cursor)
    const textAfterCursor = value.slice(cursor)
    const lastAtIndex = textBeforeCursor.lastIndexOf('@')

    if (lastAtIndex !== -1) {
      const before = textBeforeCursor.slice(0, lastAtIndex)
      const inserted = `@${file} `
      const newValue = `${before}${inserted}${textAfterCursor}`
      onChange(newValue)
      setMentionActive(false)

      setTimeout(() => {
        if (textarea) {
          textarea.focus()
          const newCursorPos = before.length + inserted.length
          textarea.setSelectionRange(newCursorPos, newCursorPos)
        }
      }, 10)
    } else {
      setMentionActive(false)
    }
  }

  const handleInputChange = (text: string) => {
    onChange(text)
    const cursor = textareaRef.current?.selectionStart ?? text.length
    const textBeforeCursor = text.slice(0, cursor)
    const lastAt = textBeforeCursor.lastIndexOf('@')

    if (lastAt !== -1 && !/\s/.test(textBeforeCursor.slice(lastAt + 1))) {
      const filter = textBeforeCursor.slice(lastAt + 1)
      setMentionFilter(filter)
      setMentionActive(true)
      setHighlightIndex(0)
    } else {
      setMentionActive(false)
    }
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionActive && candidateFiles.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setHighlightIndex(i => (i + 1) % candidateFiles.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setHighlightIndex(i => (i - 1 + candidateFiles.length) % candidateFiles.length)
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        const selected = candidateFiles[highlightIndex] || candidateFiles[0]
        if (selected) {
          handleMentionSelect(selected)
        }
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setMentionActive(false)
        return
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  const readFiles = async (files: FileList | null) => {
    const next = (
      await Promise.all(
        Array.from(files ?? []).slice(0, 5).map(async file => {
          if (file.size > 120_000) return null
          const content =
            file.type.startsWith('text/') ||
            /\.(md|mdx|txt|json|rs|ts|tsx|js|jsx|toml|yaml|yml|py|go|html|css)$/i.test(file.name)
              ? await file.text()
              : `[binary attachment: ${file.type || 'unknown'}]`
          return { name: file.name, mime_type: file.type || 'application/octet-stream', content, size: file.size }
        })
      )
    ).filter((file): file is Attachment => file !== null)

    onAttachments([
      ...attachments,
      ...next.filter(file => !attachments.some(existing => existing.name === file.name)),
    ])
  }

  return (
    <form className="composer" onSubmit={event => { event.preventDefault(); submit() }}>
      {mentionActive && candidateFiles.length > 0 && (
        <div className="mention-popover" role="listbox" aria-label="Mention file">
          <div className="mention-header">
            <span>Mention file (@)</span>
            <small>{candidateFiles.length} matches</small>
          </div>
          <div className="mention-list-scroll">
            {candidateFiles.map((file, idx) => (
              <button
                key={file}
                type="button"
                role="option"
                aria-selected={idx === highlightIndex}
                className={`mention-item ${idx === highlightIndex ? 'active' : ''}`}
                onMouseDown={e => {
                  e.preventDefault()
                  handleMentionSelect(file)
                }}
              >
                <span className="mention-file-path">{file}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <textarea
        ref={textareaRef}
        id="composerInput"
        name="prompt"
        autoComplete="off"
        spellCheck={false}
        aria-label="Prompt Rivet"
        aria-describedby="composer-help"
        value={value}
        onChange={event => handleInputChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={runActive ? 'Steer the live run…' : 'Message Rivet (type @ to reference files, / for commands)…'}
        rows={2}
      />

      <div className="composerBar">
        <div className="composerTools">
          <button
            type="button"
            className="attachButton"
            aria-label="Attach files"
            onClick={() => input.current?.click()}
            title="Attach file"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="m8.5 12.5 6-6a3 3 0 0 1 4.2 4.2l-8 8a5 5 0 1 1-7.1-7.1l8.1-8.1" />
              <path d="m6.7 14.3 7.2-7.2" />
            </svg>
          </button>

          {revision && <span className="contextChip">rev:{revision}</span>}

          {attachments.map(file => (
            <button
              type="button"
              className="contextChip chip-enter"
              key={file.name}
              onClick={() => onRemoveAttachment(file.name)}
              aria-label={`Remove attachment ${file.name}`}
              title="Remove attachment"
              style={{ cursor: 'pointer' }}
            >
              <span>{file.name} ×</span>
            </button>
          ))}
        </div>

        <div className="composerRight">
          <span className={`composerConnection ${connection}`}>
            <span aria-hidden="true" />
            {connection === 'live' ? 'live' : connection === 'connecting' ? 'connecting' : 'offline · retrying'}
          </span>
          <span className="composerCount">{value.length > 0 ? `${value.length} chars` : '⌘ ↵ send'}</span>
          {runActive && (
            <button
              type="button"
              className="iconButton stopRunBtn"
              onClick={onCancel}
              title="Stop run execution"
              style={{ width: 'auto', padding: '0 8px', gap: '4px', fontSize: '10px' }}
            >
              <span>Stop</span>
            </button>
          )}
          <button
            type="submit"
            className="sendButton"
            aria-label={runActive ? 'Steer run' : 'Send'}
            disabled={!value.trim()}
            data-ready={Boolean(value.trim())}
            data-steer={runActive}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="M12 19V5" />
              <path d="m6.5 10.5 5.5-5.5 5.5 5.5" />
            </svg>
          </button>
        </div>
      </div>

      <input
        ref={input}
        type="file"
        multiple
        hidden
        aria-label="Upload files"
        onChange={event => { void readFiles(event.target.files); event.target.value = '' }}
      />
      <div id="composer-help" className="composerHelp">
        <span>{runActive ? 'Your message becomes a steer at the next safe boundary.' : 'Enter sends · Shift+Enter adds a line · @ references repository paths'}</span>
        <span>{runActive ? 'Stop keeps the last admitted evidence.' : 'Rivet keeps chat as the authoritative surface.'}</span>
      </div>
    </form>
  )
}
