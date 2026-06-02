import React, { useState } from 'react';
import { api, ConversationChat, ConversationMessage } from '../lib/api';
import { formatDate, errMsg } from '../lib/utils';
import { SearchInput } from '../components/SearchInput';
import { useResource } from '../hooks/useResource';
import { RefreshButton } from '../components/RefreshButton';
import { Alert } from '../components/Alert';
import { expandableRowProps } from '../lib/a11y';
import { SkeletonRows } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';

export function Conversations() {
  const [filter, setFilter] = useState('');

  const { data: chats, loading, error, reload, setError } = useResource<ConversationChat[]>(
    () => api.getConversations().then((r) => r.data ?? []),
    [],
  );

  // Expanded chat state
  const [expandedChat, setExpandedChat] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);

  const toggleChat = async (chatId: string) => {
    if (expandedChat === chatId) {
      setExpandedChat(null);
      setMessages([]);
      return;
    }

    setExpandedChat(chatId);
    setMessagesLoading(true);
    try {
      const res = await api.getConversationMessages(chatId);
      setMessages(res.data ?? []);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setMessagesLoading(false);
    }
  };

  const lowerFilter = filter.toLowerCase();
  const allChats = chats ?? [];
  const filtered = lowerFilter
    ? allChats.filter(
        (c) =>
          (c.title ?? '').toLowerCase().includes(lowerFilter) ||
          (c.username ?? '').toLowerCase().includes(lowerFilter) ||
          c.id.toLowerCase().includes(lowerFilter)
      )
    : allChats;

  return (
    <div>
      <div className="header">
        <h1>Conversations</h1>
        <p>Browse chat history</p>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {/* Search + refresh bar */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
          <SearchInput
            value={filter}
            onChange={setFilter}
            placeholder="Filter chats..."
            wrapperStyle={{ flex: 1 }}
            style={{ width: '100%' }}
          />
          <RefreshButton onRefresh={reload} />
        </div>

        {error && <Alert type="error" message={error} onDismiss={() => setError(null)} style={{ margin: '12px 14px' }} />}

        {/* Chats table */}
        {loading ? (
          <div style={{ padding: '14px' }}>
            <SkeletonRows />
          </div>
        ) : filtered.length === 0 ? (
          filter ? (
            <EmptyState
              title="No matching chats"
              description="No conversations match your filter."
              action={<button className="btn-ghost btn-sm" onClick={() => setFilter('')}>Clear filters</button>}
            />
          ) : (
            <EmptyState title="No conversations yet" description="Chat history will appear here once the agent starts talking." />
          )
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)', fontSize: '11px', textTransform: 'uppercase' }}>
                <th style={{ textAlign: 'left', padding: '8px 14px' }}>Chat</th>
                <th style={{ textAlign: 'left', padding: '8px 14px', width: '80px' }}>Type</th>
                <th style={{ textAlign: 'right', padding: '8px 14px', width: '80px' }}>Messages</th>
                <th style={{ textAlign: 'right', padding: '8px 14px', width: '140px' }}>Last Active</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((chat) => {
                const isExpanded = expandedChat === chat.id;
                return (
                  <React.Fragment key={chat.id}>
                    <tr
                      onClick={() => toggleChat(chat.id)}
                      {...expandableRowProps(() => toggleChat(chat.id))}
                      style={{
                        cursor: 'pointer',
                        borderBottom: isExpanded ? 'none' : '1px solid var(--border)',
                        backgroundColor: isExpanded ? 'var(--glass-micro)' : undefined,
                      }}
                      className="file-row"
                    >
                      <td style={{ padding: '6px 14px' }}>
                        <span style={{ display: 'inline-block', width: '14px', fontSize: '10px', color: 'var(--text-secondary)', marginRight: '8px' }}>
                          {isExpanded ? '\u25BC' : '\u25B6'}
                        </span>
                        {chat.title || chat.username || chat.id}
                      </td>
                      <td style={{ padding: '6px 14px' }}>
                        <span style={{
                          display: 'inline-block',
                          padding: '1px 6px',
                          fontSize: '11px',
                          borderRadius: '3px',
                          backgroundColor: chat.type === 'dm' ? 'var(--accent-dim)' : 'var(--purple-dim)',
                          color: chat.type === 'dm' ? 'var(--accent-soft)' : 'var(--purple)',
                        }}>
                          {chat.type}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', padding: '6px 14px', color: 'var(--text-secondary)' }}>
                        {chat.message_count}
                      </td>
                      <td style={{ textAlign: 'right', padding: '6px 14px', color: 'var(--text-secondary)' }}>
                        {chat.last_message_at ? formatDate(chat.last_message_at, 1000) : '\u2014'}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr style={{ backgroundColor: 'var(--glass-micro)', borderBottom: '1px solid var(--border)' }}>
                        <td colSpan={4} style={{ padding: '0 14px 14px 14px' }}>
                          {messagesLoading ? (
                            <div style={{ padding: '12px 0', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '12px' }}>Loading messages...</div>
                          ) : messages.length === 0 ? (
                            <div style={{ padding: '12px 0', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '12px' }}>No messages</div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '8px' }}>
                              {messages.map((msg) => (
                                <div
                                  key={msg.id}
                                  style={{
                                    padding: '10px 12px',
                                    border: '1px solid var(--border)',
                                    borderRadius: '4px',
                                    backgroundColor: 'var(--bg-glass)',
                                  }}
                                >
                                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <span>{msg.sender_id || 'Unknown'}</span>
                                    {msg.is_from_agent === 1 && (
                                      <span style={{
                                        display: 'inline-block',
                                        padding: '0px 5px',
                                        fontSize: '10px',
                                        borderRadius: '3px',
                                        backgroundColor: 'var(--green-dim)',
                                        color: 'var(--green)',
                                      }}>
                                        Agent
                                      </span>
                                    )}
                                    <span style={{ marginLeft: 'auto' }}>{formatDate(msg.timestamp, 1000)}</span>
                                  </div>
                                  <pre style={{
                                    margin: 0,
                                    whiteSpace: 'pre-wrap',
                                    wordBreak: 'break-word',
                                    fontSize: '12px',
                                    fontFamily: 'monospace',
                                    lineHeight: '1.5',
                                    maxHeight: '300px',
                                    minHeight: '20px',
                                    overflow: 'auto',
                                    resize: 'vertical',
                                    color: 'var(--text-primary)',
                                  }}>
                                    {msg.text || (msg.has_media ? `[${msg.media_type || 'media'}]` : '[empty]')}
                                  </pre>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
