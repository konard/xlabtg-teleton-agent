import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

interface SearchItem {
  id: string;
  label: string;
  category: string;
  path?: string;
  action?: () => void;
  keywords?: string;
}

const NAV_ITEMS: SearchItem[] = [
  { id: 'nav-dashboard', label: 'Dashboard', category: 'Pages', path: '/', keywords: 'home overview' },
  { id: 'nav-tools', label: 'Tools', category: 'Pages', path: '/tools', keywords: 'functions capabilities' },
  { id: 'nav-plugins', label: 'Plugins', category: 'Pages', path: '/plugins', keywords: 'extensions marketplace' },
  { id: 'nav-soul', label: 'Soul', category: 'Pages', path: '/soul', keywords: 'personality identity prompt' },
  { id: 'nav-memory', label: 'Memory', category: 'Pages', path: '/memory', keywords: 'knowledge rag embeddings' },
  { id: 'nav-workspace', label: 'Workspace', category: 'Pages', path: '/workspace', keywords: 'files editor' },
  { id: 'nav-tasks', label: 'Tasks', category: 'Pages', path: '/tasks', keywords: 'queue jobs background' },
  { id: 'nav-pipelines', label: 'Pipelines', category: 'Pages', path: '/pipelines', keywords: 'dag workflow automation runs agent chain' },
  { id: 'nav-mcp', label: 'MCP', category: 'Pages', path: '/mcp', keywords: 'model context protocol servers' },
  { id: 'nav-hooks', label: 'Hooks', category: 'Pages', path: '/hooks', keywords: 'rules blocklist triggers' },
  { id: 'nav-sessions', label: 'Sessions', category: 'Pages', path: '/sessions', keywords: 'conversations chats history' },
  { id: 'nav-analytics', label: 'Analytics', category: 'Pages', path: '/analytics', keywords: 'metrics costs usage' },
  { id: 'nav-security', label: 'Security', category: 'Pages', path: '/security', keywords: 'audit access control' },
  { id: 'nav-autonomous', label: 'Autonomous', category: 'Pages', path: '/autonomous', keywords: 'autonomous mode ate self-managed goals loop agent' },
  { id: 'nav-config', label: 'Config', category: 'Pages', path: '/config', keywords: 'settings configuration api keys' },
];

const OPEN_WIDGET_GENERATOR_EVENT = 'teleton:open-widget-generator';
const OPEN_WIDGET_GENERATOR_STORAGE_KEY = 'teleton:open-widget-generator';

function fuzzyMatch(query: string, target: string): boolean {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (t.includes(q)) return true;
  // Simple fuzzy: check if all chars of query appear in order in target
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

function filterItems(items: SearchItem[], query: string): SearchItem[] {
  if (!query.trim()) return items;
  return items.filter((item) => {
    const searchable = `${item.label} ${item.keywords ?? ''} ${item.category}`;
    return fuzzyMatch(query, searchable);
  });
}

function groupByCategory(items: SearchItem[]): Map<string, SearchItem[]> {
  const map = new Map<string, SearchItem[]>();
  for (const item of items) {
    if (!map.has(item.category)) map.set(item.category, []);
    map.get(item.category)!.push(item);
  }
  return map;
}

// Module-level toggle so keyboard shortcut works before component mounts
let setOpenGlobal: ((open: boolean) => void) | null = null;

export function openCommandPalette() {
  setOpenGlobal?.(true);
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // Register global setter
  useEffect(() => {
    setOpenGlobal = setOpen;
    return () => { setOpenGlobal = null; };
  }, []);

  // Keyboard shortcut: Ctrl+K / Cmd+K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const commandItems: SearchItem[] = [
    {
      id: 'cmd-generate-widget',
      label: 'Generate Widget',
      category: 'Commands',
      keywords: 'dashboard ai chart table custom visualization',
      action: () => {
        try {
          sessionStorage.setItem(OPEN_WIDGET_GENERATOR_STORAGE_KEY, '1');
        } catch {
          // ignore storage errors
        }
        navigate('/');
        window.setTimeout(() => {
          window.dispatchEvent(new CustomEvent(OPEN_WIDGET_GENERATOR_EVENT));
        }, 50);
      },
    },
  ];
  const allItems = [...NAV_ITEMS, ...commandItems];
  const filtered = filterItems(allItems, query);
  const grouped = groupByCategory(filtered);
  const flatFiltered = filtered;

  const handleSelect = useCallback((item: SearchItem) => {
    setOpen(false);
    if (item.path) navigate(item.path);
    else item.action?.();
  }, [navigate]);

  // Arrow key navigation
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, flatFiltered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (flatFiltered[selectedIndex]) handleSelect(flatFiltered[selectedIndex]);
    }
  };

  if (!open) return null;

  let globalIndex = 0;

  return (
    <div className="command-palette-overlay" onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="command-palette" onClick={(e) => e.stopPropagation()}>
        <div className="command-palette-search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            className="command-palette-input"
            placeholder="Search pages and commands..."
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
            onKeyDown={onKeyDown}
            aria-label="Search"
            aria-autocomplete="list"
            role="combobox"
            aria-expanded="true"
          />
        </div>
        <div className="command-palette-results" role="listbox">
          {flatFiltered.length === 0 && (
            <div className="command-palette-empty">No results for "{query}"</div>
          )}
          {Array.from(grouped.entries()).map(([category, items]) => (
            <div key={category}>
              <div className="command-palette-category">{category}</div>
              {items.map((item) => {
                const idx = globalIndex++;
                const isSelected = idx === selectedIndex;
                return (
                  <button
                    key={item.id}
                    className={`command-palette-item ${isSelected ? 'selected' : ''}`}
                    onClick={() => handleSelect(item)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    role="option"
                    aria-selected={isSelected}
                  >
                    <span className="command-palette-item-label">{item.label}</span>
                    {item.path && (
                      <span className="command-palette-item-path">{item.path}</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="command-palette-footer">
          <span><kbd>↑↓</kbd> Navigate</span>
          <span><kbd>↵</kbd> Select</span>
          <span><kbd>Esc</kbd> Close</span>
        </div>
      </div>
    </div>
  );
}
