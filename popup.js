let docList = [];
let caseNum = '';

// ── 页面打开时自动扫描 ──────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  autoScan();
});

async function autoScan() {
  setStatus('🔍', '正在识别当前页面...');

  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (e) {
    setStatus('❌', '无法获取当前标签页');
    return;
  }

  // 检查域名是否匹配
  const url = tab.url || '';
  if (!url.includes('hshfy.sh.cn')) {
    setStatus('⚠️', '当前页面不是上海法院文书送达页面。\n请先打开对应链接再点击插件图标。');
    return;
  }

  // 注入脚本提取文书
  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractDocsFromPage,
    });
  } catch (e) {
    setStatus('❌', `页面脚本执行失败：${e.message}`);
    return;
  }

  const data = results?.[0]?.result;

  if (!data || data.error) {
    setStatus('❌', data?.error || '提取失败，请刷新页面后重试');
    return;
  }

  if (data.docs.length === 0) {
    setStatus('⚠️', '页面已识别，但未找到任何文书。\n请确认页面已完整加载。');
    return;
  }

  // 保存结果
  docList = data.docs;
  caseNum = data.caseNum;

  // 显示文书列表
  renderDocList(caseNum, docList);
  setStatus('✅', `识别成功，共 ${docList.length} 份文书，将自动存入文件夹：\n「${caseNum}」`);
  document.getElementById('btnDown').style.display = 'block';
}

// ── 下载按钮 ────────────────────────────────────
document.getElementById('btnDown').addEventListener('click', async () => {
  if (docList.length === 0) return;

  const btn = document.getElementById('btnDown');
  btn.disabled = true;

  showProgress(true);

  let ok = 0, fail = 0;
  for (let i = 0; i < docList.length; i++) {
    const doc = docList[i];
    updateProgress(i, docList.length, doc.name);

    try {
      // 关键：filename 含子目录 → Chrome 自动在下载目录下建文件夹
      await chrome.downloads.download({
        url: doc.url,
        filename: `${sanitize(caseNum)}/${sanitize(doc.name)}`,
        conflictAction: 'uniquify',
      });
      ok++;
    } catch (e) {
      fail++;
    }

    await sleep(800);
  }

  updateProgress(docList.length, docList.length, '全部完成');
  setStatus(
    '🎉',
    `下载完成！成功 ${ok} 份${fail ? `，失败 ${fail} 份` : ''}。\n文件夹：「${caseNum}」`
  );
  btn.disabled = false;
  btn.textContent = '✅ 已全部下载';
});

// ── UI 工具函数 ─────────────────────────────────
function setStatus(icon, text) {
  document.getElementById('statusIcon').textContent = icon;
  // 支持换行
  document.getElementById('statusText').innerHTML =
    text.replace(/\n/g, '<br>');
}

function renderDocList(caseNum, docs) {
  const box = document.getElementById('docList');
  let html = `<div class="case-title">📁 ${caseNum}</div>`;
  docs.forEach(d => {
    html += `<div class="doc-item">${d.name}</div>`;
  });
  box.innerHTML = html;
  box.style.display = 'block';
}

function showProgress(show) {
  document.getElementById('progressWrap').style.display = show ? 'block' : 'none';
}

function updateProgress(current, total, name) {
  const pct = Math.round((current / total) * 100);
  document.getElementById('progressFill').style.width = pct + '%';
  document.getElementById('progressText').textContent =
    `${current}/${total}  ${name}`;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function sanitize(name) {
  // 移除 Windows 文件名非法字符，保留中文括号
  return name.replace(/[\\/*?:"<>|]/g, '_').trim();
}

// ── 注入到目标页面执行（不可引用外部变量）────────
function extractDocsFromPage() {
  try {
    // 案件编号
    const caseEl = document.querySelector('h3 span');
    if (!caseEl) return { error: '未找到案件编号，请确认页面已加载' };
    const caseNum = caseEl.innerText.trim();

    // 文书列表
    const items = document.querySelectorAll('.list-block li');
    if (items.length === 0) return { error: '未找到文书列表，请确认页面已加载' };

    const docs = [];
    items.forEach(li => {
      const nameEl  = li.querySelector('.item-title span');
      const name    = nameEl ? nameEl.innerText.trim() : '未知文书';
      const aEl     = li.querySelector('a');
      const onclick = aEl ? (aEl.getAttribute('onclick') || '') : '';

      // 匹配 showPdf("d:\/path\/file.pdf")
      const match = onclick.match(/showPdf\(["'](.+?)["']\)/);
      if (!match) return;

      // 路径反转义：d:\/wswssd\/... → /wswssd/...
      const raw     = match[1].replace(/\\\//g, '/').replace(/\\/g, '/');
      const urlPart = raw.includes(':') ? raw.split(':').slice(1).join(':') : raw;
      const ts      = Date.now();
      const url     = `http://www.hshfy.sh.cn//file/ssfww${urlPart}?timestamp=${ts}`;

      docs.push({ name, url });
    });

    return { caseNum, docs };
  } catch (e) {
    return { error: e.message };
  }
}
