import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import '../wf-theme.css';
import { SLUG_OF } from '../workshops-data.js';

const DRAFT_KEY = 'wonder-forge:combiner:draft';
const POLL_INTERVAL_MS = 3000;

const RELIC_STREAMS = [
  {
    name: '老式电话机',
    image: '/textures/phone-dial.jpg',
    upgrade: 'AI 声音',
    tone: 'rose',
  },
  {
    name: '木质相框',
    image: '/frame/frame-plain.jpg',
    upgrade: '记忆屏',
    tone: 'amber',
  },
  {
    name: '复古台灯',
    image: '/lamp/lamp-plain.jpg',
    upgrade: '智能光',
    tone: 'mint',
  },
  {
    name: '老式收音机',
    image: '/radio/radio-plain.jpg',
    upgrade: '语音中枢',
    tone: 'blue',
  },
  {
    name: '机械怀表',
    image: '/watch/watch-plain.jpg',
    upgrade: '时间提醒',
    tone: 'amber',
  },
  {
    name: '搪瓷暖水壶',
    image: '/thermos/thermos-plain.jpg',
    upgrade: '温度感知',
    tone: 'rose',
  },
  {
    name: '手摇缝纫机',
    image: '/sewing/sewing-plain.jpg',
    upgrade: '动作记录',
    tone: 'mint',
  },
  {
    name: '木质算盘',
    image: '/abacus/abacus-plain.jpg',
    upgrade: '数据交互',
    tone: 'blue',
  },
];

export default function Combiner() {
  const [items, setItems] = useState(null);
  const [daily, setDaily] = useState([]);
  const [hardware, setHardware] = useState([]);
  const [ai, setAi] = useState([]);
  const [idea, setIdea] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [category, setCategory] = useState('daily_items');
  const [history, setHistory] = useState([]);
  const [storageReady, setStorageReady] = useState(false);
  const [workbenchNotice, setWorkbenchNotice] = useState('');
  const [progress, setProgress] = useState({ stage: '', text: '' });
  const [taskId, setTaskId] = useState(null);
  const pollRef = useRef(null);

  // ===== 服务端历史 =====
  const refreshHistory = async () => {
    try {
      const res = await fetch('/api/history');
      if (res.ok) setHistory(await res.json());
    } catch {
      // 历史加载失败不打断页面
    }
  };

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  // 组件卸载时停止轮询
  useEffect(() => () => stopPolling(), []);

  useEffect(() => {
    try {
      const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
      if (Array.isArray(draft?.daily)) setDaily(draft.daily);
      if (Array.isArray(draft?.hardware)) setHardware(draft.hardware);
      if (Array.isArray(draft?.ai)) setAi(draft.ai);
      if (typeof draft?.idea === 'string') setIdea(draft.idea);
    } catch {
      localStorage.removeItem(DRAFT_KEY);
    } finally {
      setStorageReady(true);
    }
    refreshHistory();
  }, []);

  useEffect(() => {
    fetch('/api/items')
      .then((r) => r.json())
      .then(setItems)
      .catch((e) => setError('无法加载奇物库：' + e.message));
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ daily, hardware, ai, idea }));
  }, [daily, hardware, ai, idea, storageReady]);

  const toggle = (list, setList, id) =>
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const enterWorkbench = (categoryKey, setList, item) => {
    setList((current) => current.includes(item.id) ? current : [...current, item.id]);
    setCategory(categoryKey);
    setWorkbenchNotice(`已将「${item.name}」加入搭配工作间`);
    window.setTimeout(() => setWorkbenchNotice(''), 2600);
    window.requestAnimationFrame(() => window.setTimeout(() => {
      document.getElementById('workbench')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 40));
  };

  // ===== 异步任务：提交 + 轮询 + 取消 =====
  const startPolling = (id) => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/combine/tasks/${id}`);
        if (!res.ok) return; // 网络抖动：跳过本轮，下轮重试
        const task = await res.json();
        setProgress({ stage: task.stage || 'AI 处理中', text: task.text || '' });
        if (task.state === 'done') {
          stopPolling();
          setTaskId(null);
          setResult(task.result);
          setLoading(false);
          refreshHistory(); // 生成成功后自动落历史库，刷新列表
        } else if (task.state === 'failed') {
          stopPolling();
          setTaskId(null);
          setError(task.error || '生成失败');
          setLoading(false);
        } else if (task.state === 'cancelled') {
          stopPolling();
          setTaskId(null);
          setError('已取消生成');
          setLoading(false);
        }
      } catch {
        // 轮询网络异常：下轮重试
      }
    }, POLL_INTERVAL_MS);
  };

  const combine = async () => {
    setLoading(true);
    setError('');
    setResult(null);
    setProgress({ stage: '提交中', text: '' });
    try {
      const res = await fetch('/api/combine/async', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          daily_ids: daily,
          hardware_ids: hardware,
          ai_ids: ai,
          idea,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '提交失败');
      setTaskId(data.task_id);
      setProgress({ stage: '已提交，AI 创作中', text: '' });
      startPolling(data.task_id);
    } catch (e) {
      setError(String(e.message || e));
      setLoading(false);
    }
  };

  const cancelCombine = async () => {
    const id = taskId;
    stopPolling();
    if (id) {
      try {
        await fetch(`/api/combine/tasks/${id}`, { method: 'DELETE' });
      } catch {
        // 取消请求失败不阻塞：本地直接终止轮询
      }
    }
    setTaskId(null);
    setLoading(false);
    setError('已取消生成');
  };

  const loadRecord = (record) => {
    const sel = record.selection || {};
    setDaily(sel.daily_ids || []);
    setHardware(sel.hardware_ids || []);
    setAi(sel.ai_ids || []);
    setIdea(sel.idea || '');
    setResult(record.result || null);
    setCategory(sel.daily_ids?.length ? 'daily_items' : sel.hardware_ids?.length ? 'hardware_parts' : 'ai_modules');
    setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const deleteRecord = async (id) => {
    try {
      await fetch(`/api/history/${id}`, { method: 'DELETE' });
    } catch {
      // 删除失败时刷新一次，以服务端为准
    }
    refreshHistory();
  };

  const clearHistory = async () => {
    try {
      await fetch('/api/history', { method: 'DELETE' });
    } catch {
      // 同上
    }
    setHistory([]);
  };

  const formatDate = (value) => new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));

  if (!items) {
    return (
      <div className="wf-combine">
        <header className="topbar">
          <div className="brand"><Link to="/">万物改造工坊</Link> <span className="glow">WonderForge</span></div>
          <nav className="nav">
            <Link to="/combine" className="active">搭配工作间</Link>
            <Link to="/demos">3D 演示</Link>
            <Link to="/community">社区</Link>
          </nav>
        </header>
        <main className="wf-body">
          <div className="skeleton" style={{ marginTop: 56 }} />
          <div className="skeleton" style={{ height: 140, marginTop: 18 }} />
        </main>
      </div>
    );
  }

  const listNames = (ids, list) =>
    ids.map((id) => list.find((x) => x.id === id)?.name).filter(Boolean);

  return (
    <div className="wf-combine">
      <header className="topbar">
        <div className="brand"><Link to="/">万物改造工坊</Link> <span className="glow">WonderForge</span></div>
        <nav className="nav">
            <Link to="/combine" className="active">搭配工作间</Link>
          <Link to="/demos">3D 演示</Link>
          <Link to="/community">社区</Link>
        </nav>
      </header>

      <div className="wf-relic-layer" aria-hidden="true">
        <div className="wf-relic-caption">
          <span className="wf-relic-caption-dot" />
          <span>旧物资料库</span>
          <b>新功能流动中</b>
        </div>
        <div className="wf-relic-track wf-relic-track-a">
          {[...RELIC_STREAMS, ...RELIC_STREAMS].map((item, index) => (
            <div
              className={`wf-relic-item tone-${item.tone}`}
              key={`a-${item.name}-${index}`}
              style={{ '--item-tilt': `${index % 2 ? 2 : -2}deg` }}
            >
              <img src={item.image} alt="" />
              <span className="wf-relic-item-copy">
                <strong>{item.name}</strong>
                <small><i>＋</i>{item.upgrade}</small>
              </span>
            </div>
          ))}
        </div>
        <div className="wf-relic-track wf-relic-track-b">
          {[...RELIC_STREAMS.slice(3), ...RELIC_STREAMS.slice(0, 3), ...RELIC_STREAMS.slice(3), ...RELIC_STREAMS.slice(0, 3)].map((item, index) => (
            <div
              className={`wf-relic-item tone-${item.tone}`}
              key={`b-${item.name}-${index}`}
              style={{ '--item-tilt': `${index % 2 ? -2 : 2}deg` }}
            >
              <img src={item.image} alt="" />
              <span className="wf-relic-item-copy">
                <strong>{item.name}</strong>
                <small><i>＋</i>{item.upgrade}</small>
              </span>
            </div>
          ))}
        </div>
        <div className="wf-relic-scanline" />
      </div>

      <span className="wf-orb o1" aria-hidden="true" />
      <span className="wf-orb o2" aria-hidden="true" />
      <span className="wf-orb o3" aria-hidden="true" />

      <main className="wf-body">
        <section className="wf-hero">
          <div className="wf-dust" aria-hidden="true"><i /><i /><i /><i /><i /><i /></div>
          <span className="wf-eyebrow">搭配工作间 · 温柔创造</span>
          <h1 className="wf-line">
            选一件旧物，加一点心意，<br />
            组合出<em className="wf-hl rose">新的可能</em>。
          </h1>
          <p className="wf-sub">
            从奇物库挑选日常物品、功能部件或 AI 模组，写下你期待的样子——<br className="wf-br" />
            我们帮你把念头，变成看得见的产品方案。
          </p>
          <div className="wf-memory-wall" aria-label="温馨回忆留言墙">
            <aside className="wf-memory-note note-a">
              <span className="wf-note-pin" aria-hidden="true" />
              <div className="wf-note-meta">
                <span>旧物留言 · 01</span>
                <time dateTime="1987">1987 → 今天</time>
              </div>
              <p>“这只老电话，替我接住了很多没说出口的想念。”</p>
              <div className="wf-note-sign">— 写给还在等的人</div>
              <span className="wf-note-stamp">MEMORY / KEPT</span>
            </aside>
            <aside className="wf-memory-note note-b">
              <span className="wf-note-pin" aria-hidden="true" />
              <div className="wf-note-meta">
                <span>旧物留言 · 02</span>
                <time dateTime="1998">1998 → 今天</time>
              </div>
              <p>“那把梳子还在抽屉里，等下一次有人轻轻拿起。”</p>
              <div className="wf-note-sign">— 写给爱梳头发的你</div>
              <span className="wf-note-stamp">HELD / CLOSE</span>
            </aside>
            <aside className="wf-memory-note note-c">
              <span className="wf-note-pin" aria-hidden="true" />
              <div className="wf-note-meta">
                <span>旧物留言 · 03</span>
                <time dateTime="2001">2001 → 今天</time>
              </div>
              <p>“灯亮起来的时候，家就有了回声。”</p>
              <div className="wf-note-sign">— 写给每个晚归的人</div>
              <span className="wf-note-stamp">LIGHT / HOME</span>
            </aside>
          </div>
          <button
            type="button"
            className="wf-workbench-jump"
            onClick={() => document.getElementById('workbench')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          >
            进入搭配工作间 <span aria-hidden="true">↓</span>
          </button>
        </section>

        <div className="wf-workbench-head" id="workbench">
          <div>
            <span className="wf-workbench-kicker">MIX LAB · 搭配工作间</span>
            <h2>把旧物和新功能，放在一起试试看</h2>
          </div>
          <p>从下方选择日常物品、功能部件或 AI 模组，开始你的组合。</p>
        </div>
        {workbenchNotice && <div className="wf-workbench-notice" role="status" aria-live="polite">{workbenchNotice}</div>}

        <div className="category-tabs" role="tablist" aria-label="选择模组类别">
          {[
            ['daily_items', '日常物品', daily.length],
            ['hardware_parts', '功能部件', hardware.length],
            ['ai_modules', 'AI 模组', ai.length],
          ].map(([key, label, count]) => (
            <button key={key} type="button" role="tab" aria-selected={category === key}
              className={category === key ? 'category-tab active' : 'category-tab'} onClick={() => setCategory(key)}>
              {label}<span>{count}</span>
            </button>
          ))}
        </div>

        {category === 'daily_items' && <>
        <div className="wf-daily-head">
          <div>
            <span className="wf-daily-kicker">01 / DAILY OBJECTS</span>
            <h3>日常物品搭配工作间</h3>
            <span className="wf-daily-count">共 {items.daily_items.length} 件旧物</span>
          </div>
          <p>先挑一件有故事的旧物，再给它加上一项新能力。</p>
        </div>
        <div className="grid3 cat-daily">
          {items.daily_items.map((x) => (
            <div key={x.id} className={daily.includes(x.id) ? 'card selected' : 'card'} style={{ cursor: 'pointer' }} onClick={() => toggle(daily, setDaily, x.id)}>
              <div style={{ fontWeight: 700 }}>{x.name}</div>
              <div style={{ color: 'var(--muted)', fontSize: 12, margin: '4px 0 8px' }}>{x.desc}</div>
              <div>
                {x.tags.map((t) => (
                  <span key={t} className="chip" style={{ pointerEvents: 'none', marginRight: 4, padding: '2px 8px', fontSize: 11 }}>
                    {t}
                  </span>
                ))}
              </div>
              <div className="wf-item-card-footer">
                <div style={{ fontSize: 12, color: daily.includes(x.id) ? 'var(--accent)' : 'transparent' }}>
                  {daily.includes(x.id) ? '✓ 已选' : '·'}
                </div>
                {SLUG_OF[x.id] && (
                  <Link to={`/combine/${SLUG_OF[x.id]}`} className="wf-item-workbench-btn" onClick={(e) => e.stopPropagation()}>
                    搭配工作间 <span aria-hidden="true">→</span>
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
        </>}

        {category === 'hardware_parts' && <>
        <div className="section-label">② 功能部件 · 共 {items.hardware_parts.length} 件</div>
        <div className="grid3 cat-hardware">
          {items.hardware_parts.map((x) => (
            <div key={x.id} className={hardware.includes(x.id) ? 'card selected' : 'card'} style={{ cursor: 'pointer' }} onClick={() => toggle(hardware, setHardware, x.id)}>
              <div style={{ fontWeight: 700 }}>{x.name}</div>
              <div style={{ color: 'var(--muted)', fontSize: 12, margin: '4px 0 8px' }}>{x.desc}</div>
              <div className="wf-item-card-footer">
                <div style={{ fontSize: 12, color: hardware.includes(x.id) ? 'var(--accent)' : 'transparent' }}>
                  {hardware.includes(x.id) ? '✓ 已选' : '·'}
                </div>
                <button type="button" className={`wf-item-workbench-btn${hardware.includes(x.id) ? ' is-selected' : ''}`} aria-pressed={hardware.includes(x.id)} onClick={(e) => {
                  e.stopPropagation();
                  enterWorkbench('hardware_parts', setHardware, x);
                }}>
                  {hardware.includes(x.id) ? '已加入工作间' : '搭配工作间'} <span aria-hidden="true">{hardware.includes(x.id) ? '✓' : '→'}</span>
                </button>
              </div>
            </div>
          ))}
        </div>
        </>}

        {category === 'ai_modules' && <>
        <div className="section-label">③ AI 模组 · 共 {items.ai_modules.length} 件</div>
        <div className="grid3 cat-ai">
          {items.ai_modules.map((x) => (
            <div key={x.id} className={ai.includes(x.id) ? 'card selected' : 'card'} style={{ cursor: 'pointer' }} onClick={() => toggle(ai, setAi, x.id)}>
              <div style={{ fontWeight: 700 }}>{x.name}</div>
              <div style={{ color: 'var(--muted)', fontSize: 12, margin: '4px 0 8px' }}>{x.desc}</div>
              <div className="wf-item-card-footer">
                <div style={{ fontSize: 12, color: ai.includes(x.id) ? 'var(--accent)' : 'transparent' }}>
                  {ai.includes(x.id) ? '✓ 已选' : '·'}
                </div>
                <button type="button" className={`wf-item-workbench-btn${ai.includes(x.id) ? ' is-selected' : ''}`} aria-pressed={ai.includes(x.id)} onClick={(e) => {
                  e.stopPropagation();
                  enterWorkbench('ai_modules', setAi, x);
                }}>
                  {ai.includes(x.id) ? '已加入工作间' : '搭配工作间'} <span aria-hidden="true">{ai.includes(x.id) ? '✓' : '→'}</span>
                </button>
              </div>
            </div>
          ))}
        </div>
        </>}

        <div className="section-label">预期效果（可选）</div>
        <textarea
          rows={3}
          placeholder="例如：想给杯子加上夜光，做成夜晚会发光的记忆杯…"
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
        />

        <div style={{ marginTop: 20, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn" onClick={combine} disabled={loading || (!daily.length && !hardware.length && !ai.length)}>
            {loading ? (<><span className="spin" /> {progress.stage || '生成中'}…</>) : '生成产品方案'}
          </button>
          {loading && (
            <button type="button" className="btn ghost" onClick={cancelCombine}>取消生成</button>
          )}
          <div className="selected-summary">
            已选：{listNames(daily, items.daily_items).join('、') || '无物品'} · {listNames(hardware, items.hardware_parts).join('、') || '无部件'} · {listNames(ai, items.ai_modules).join('、') || '无模组'}
          </div>
        </div>

        {loading && (
          <div className="card" style={{ marginTop: 14, padding: '14px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{progress.stage || 'AI 创作中'}<span className="spin" style={{ marginLeft: 8 }} /></div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>约 1-3 分钟 · 刷新页面任务不丢失，可稍后回来查看</div>
            </div>
            {progress.text ? (
              <div style={{ marginTop: 10, maxHeight: 120, overflow: 'hidden', fontSize: 12, color: 'var(--muted)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                {progress.text.slice(0, 400)}
              </div>
            ) : (
              <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>AI 正在构思产品方案，已生成的部分会实时显示在这里…</div>
            )}
          </div>
        )}

        {error && <div className="error-box">出错了：{error}</div>}

        {result && (
          <div style={{ marginTop: 28 }}>
            <div className="section-label">生成结果</div>
            <div className="result-grid">
              <div>
                <div className="card">
                  <div className="result-name">{result.result?.name}</div>
                  <div style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.7 }}>{result.result?.intro}</div>
                </div>
                <div className="card" style={{ marginTop: 12 }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>核心玩法</div>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.8 }}>
                    {(result.result?.play || []).map((p, i) => <li key={i}>{p}</li>)}
                  </ul>
                  <div style={{ fontWeight: 700, margin: '12px 0 6px' }}>材料清单</div>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.8 }}>
                    {(result.result?.materials || []).map((m, i) => <li key={i}>{m}</li>)}
                  </ul>
                  <div style={{ fontWeight: 700, margin: '12px 0 6px' }}>组装步骤</div>
                  <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.8 }}>
                    {(result.result?.steps || []).map((s, i) => <li key={i}>{s}</li>)}
                  </ol>
                </div>
              </div>
              <div>
                {result.image_urls?.length > 0 ? (
                  <div className="media-box">
                    <img src={result.image_urls[0]} alt={result.result?.name || '生成图'} />
                  </div>
                ) : (
                  <div className="media-box" style={{ color: 'var(--muted)', fontSize: 13, padding: 20, textAlign: 'center' }}>
                    效果图生成中或未返回，稍后可重试
                  </div>
                )}
                <div className="video-slot" aria-label="视频预留位">
                  <span className="play-btn">▶</span>
                  <span>预期视频</span>
                </div>
                {result.web_thread_link && (
                  <div style={{ marginTop: 10, fontSize: 12 }}>
                    会话链接：<a href={result.web_thread_link} target="_blank" rel="noreferrer" style={{ color: 'var(--accent2)' }}>在小云雀查看</a>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <section className="history-panel" aria-label="组合记录">
          <div className="history-heading">
            <div>
              <div className="section-label">组合记录</div>
              <div className="history-caption">已保存 {history.length} 条（服务端存储，换设备不丢失）· 当前选择会自动保存为草稿</div>
            </div>
            {history.length > 0 && <button type="button" className="text-button" onClick={clearHistory}>清空记录</button>}
          </div>
          {history.length === 0 ? (
            <div className="history-empty">生成产品方案后，组合与效果图会出现在这里（自动保存到服务端）。</div>
          ) : (
            <div className="history-list">
              {history.map((record) => {
                const sel = record.selection || {};
                const selectedNames = [
                  ...listNames(sel.daily_ids || [], items?.daily_items || []),
                  ...listNames(sel.hardware_ids || [], items?.hardware_parts || []),
                  ...listNames(sel.ai_ids || [], items?.ai_modules || []),
                ];
                return (
                  <div className="history-row" key={record.id}>
                    <div className="history-row-main">
                      <div className="history-name">{record.result?.result?.name || '未命名组合'}</div>
                      <div className="history-items">{selectedNames.join(' + ') || '暂无物品'}</div>
                      <div className="history-date">{formatDate(record.createdAt)}</div>
                    </div>
                    <div className="history-actions">
                      <button type="button" className="btn ghost compact" onClick={() => loadRecord(record)}>载入</button>
                      <button type="button" className="text-button danger" onClick={() => deleteRecord(record.id)}>删除</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <footer className="wf-footer">
          <span className="wf-footer-brand">万物改造工坊 WonderForge</span>
          <span className="wf-footer-sep">·</span>
          <span className="wf-footer-motto">为每一件旧物，留住一段温柔的时光</span>
        </footer>
      </main>
    </div>
  );
}
