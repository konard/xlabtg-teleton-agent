interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  style?: React.CSSProperties;
  wrapperStyle?: React.CSSProperties;
}

export function SearchInput({ value, onChange, placeholder = 'Search...', style, wrapperStyle }: SearchInputProps) {
  return (
    <div style={{ position: 'relative', ...wrapperStyle }}>
      <input
        type="text"
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') onChange(''); }}
        style={{
          padding: '4px 24px 4px 12px',
          fontSize: '13px',
          border: '1px solid var(--border)',
          backgroundColor: 'transparent',
          color: 'var(--text-primary)',
          width: '180px',
          outline: 'none',
          ...style,
        }}
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange('')}
          style={{
            position: 'absolute',
            right: '4px',
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'none',
            border: 'none',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            padding: '0 2px',
            fontSize: '14px',
            lineHeight: 1,
          }}
        >
          &#x2715;
        </button>
      )}
    </div>
  );
}
