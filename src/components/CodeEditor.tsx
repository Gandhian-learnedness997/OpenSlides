import React, { useRef, useEffect, useState } from "react";
import { useLanguage } from "../hooks/useLanguage";
import Prism from "prismjs";
import "prismjs/themes/prism-tomorrow.css";
import "prismjs/components/prism-markup"; // HTML support
import "prismjs/components/prism-css";
import "prismjs/components/prism-javascript";

interface CodeEditorProps {
  code: string;
  onChange: (code: string) => void;
}

export default function CodeEditor({ code, onChange }: CodeEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const preRef = useRef<HTMLPreElement | null>(null);
  const lineNumbersRef = useRef<HTMLDivElement | null>(null);
  const [cursor, setCursor] = useState<number | { start: number; end: number } | null>(null);

  // Restore cursor position after content update
  useEffect(() => {
    if (cursor !== null && textareaRef.current) {
      if (typeof cursor === 'number') {
        textareaRef.current.selectionStart = cursor;
        textareaRef.current.selectionEnd = cursor;
      } else {
        textareaRef.current.selectionStart = cursor.start;
        textareaRef.current.selectionEnd = cursor.end;
      }
      setCursor(null);
    }
  }, [code, cursor]);

  // Sync scroll positions
  const handleScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    const target = e.target as HTMLTextAreaElement;
    if (preRef.current) {
      preRef.current.scrollTop = target.scrollTop;
      preRef.current.scrollLeft = target.scrollLeft;
    }
    if (lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = target.scrollTop;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const target = e.target as HTMLTextAreaElement;
    const { value, selectionStart, selectionEnd } = target;

    // Tab Indentation
    if (e.key === 'Tab') {
      e.preventDefault();

      const start = selectionStart;
      const end = selectionEnd;

      // Find start of the line where selection starts
      const startLineStart = value.lastIndexOf('\n', start - 1) + 1;

      // Find end of the line where selection ends
      let endLineEnd = value.indexOf('\n', end);
      if (endLineEnd === -1) endLineEnd = value.length;

      // Adjust effective end to avoid indenting the next line if selection ends at column 0
      if (end > start && value[end - 1] === '\n') {
        const effectiveEnd = end - 1;
        endLineEnd = value.lastIndexOf('\n', effectiveEnd - 1);
        // If single line selected and ends with \n, endLineEnd might be before startLineStart?
        // No, value.lastIndexOf('\n', effectiveEnd - 1) would be the newline BEFORE the last line.
        // Wait, we want the end of the block.
        // If block is "Line 1\n", start=0, end=7.
        // effectiveEnd = 6.
        // endLineEnd needs to be 6.
        endLineEnd = effectiveEnd;
      }

      const beforeBlock = value.substring(0, startLineStart);
      const block = value.substring(startLineStart, endLineEnd);
      const afterBlock = value.substring(endLineEnd);

      const lines = block.split('\n');

      if (e.shiftKey) {
        // Unindent
        const newLines = lines.map(line => {
           if (line.startsWith('  ')) return line.substring(2);
           if (line.startsWith(' ')) return line.substring(1);
           return line;
        });

        const newValue = beforeBlock + newLines.join('\n') + afterBlock;
        onChange(newValue);

        // Select the modified block
        setCursor({
          start: startLineStart,
          end: startLineStart + newLines.join('\n').length + (end > start && value[end - 1] === '\n' ? 1 : 0)
        });
      } else {
        // Indent
        if (start === end) {
             const newValue = value.substring(0, start) + "  " + value.substring(end);
             onChange(newValue);
             setCursor(start + 2);
             return;
        }

        const newLines = lines.map(line => "  " + line);
        const newValue = beforeBlock + newLines.join('\n') + afterBlock;
        onChange(newValue);

        setCursor({
          start: startLineStart,
          end: startLineStart + newLines.join('\n').length + (end > start && value[end - 1] === '\n' ? 1 : 0)
        });
      }
      return;
    }

    // Auto-close Tag
    if (e.key === '>') {
      const textBefore = value.substring(0, selectionStart);
      // Match opening tag pattern: <tag or <tag attr="..."
      // We look for the last '<' that isn't closed
      const lastOpenBracket = textBefore.lastIndexOf('<');
      if (lastOpenBracket !== -1) {
        const potentialTag = textBefore.substring(lastOpenBracket + 1);
        // Check if it's not a closing tag </...
        if (!potentialTag.startsWith('/')) {
          // Extract tag name
          const tagMatch = potentialTag.match(/^([a-zA-Z0-9-]+)/);
          if (tagMatch) {
            // Check if we are not already in a tag or if this > closes it
            // Simple heuristic: if no > since the <
            if (potentialTag.indexOf('>') === -1) {
              e.preventDefault();
              const tagName = tagMatch[1];
              // Don't auto-close void tags (img, br, hr, input, etc.)
              const voidTags = ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'];

              if (voidTags.includes(tagName.toLowerCase())) {
                 const newValue = value.substring(0, selectionStart) + ">" + value.substring(selectionEnd);
                 onChange(newValue);
                 setCursor(selectionStart + 1);
              } else {
                 const newValue = value.substring(0, selectionStart) + ">" + `</${tagName}>` + value.substring(selectionEnd);
                 onChange(newValue);
                 setCursor(selectionStart + 1);
              }
            }
          }
        }
      }
    }
  };

  return (
    <div className="w-full h-full bg-[#1e1e1e] overflow-hidden rounded-lg shadow-inner border border-[#333] flex relative group min-h-0">
      {/* Line Numbers */}
      <div
        ref={lineNumbersRef}
        className="bg-[#1e1e1e] text-[#858585] py-4 pr-4 pl-2 text-right select-none border-r border-[#333] overflow-hidden"
        style={{ fontFamily: "'Fira Code', 'Consolas', 'Monaco', monospace", minWidth: '3.5rem', fontSize: '13px', lineHeight: '1.5' }}
      >
        {code.split('\n').map((_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>

      {/* Editor Area */}
      <div className="flex-1 relative h-full overflow-hidden min-h-0">
        {/* Syntax Highlighted Layer */}
        <pre
          ref={preRef}
          className="absolute inset-0 m-0 p-4 bg-transparent pointer-events-none z-0"
          style={{
            fontFamily: "'Fira Code', 'Consolas', 'Monaco', monospace",
            fontSize: '13px',
            lineHeight: '1.5',
            whiteSpace: 'pre',
            overflow: 'auto',
            tabSize: 2,
            scrollbarWidth: 'none',
          }}
        >
          <code
            className="language-html"
            style={{
              fontFamily: 'inherit',
              fontSize: 'inherit',
              lineHeight: 'inherit',
              whiteSpace: 'inherit',
              tabSize: 'inherit',
              letterSpacing: 'inherit',
              wordSpacing: 'inherit',
            }}
            dangerouslySetInnerHTML={{
              __html: (Prism.languages.html || Prism.languages.markup
                ? Prism.highlight(code || '', Prism.languages.html || Prism.languages.markup, 'html')
                : (code || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')) + '<br />'
            }}
          />
        </pre>

        {/* Editable Textarea Layer */}
        <textarea
          ref={textareaRef}
          value={code}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)}
          onScroll={handleScroll}
          onKeyDown={handleKeyDown}
          className="absolute inset-0 w-full h-full bg-transparent text-transparent caret-white outline-none resize-none p-4 overflow-auto custom-scrollbar selection:bg-[#264f78]/30 z-10"
          spellCheck="false"
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          style={{
            fontFamily: "'Fira Code', 'Consolas', 'Monaco', monospace",
            fontSize: '13px',
            lineHeight: '1.5',
            whiteSpace: 'pre',
            tabSize: 2,
          }}
        />
      </div>
    </div>
  );
}
