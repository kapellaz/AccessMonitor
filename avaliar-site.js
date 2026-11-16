/**
 * Script de Avaliação em Massa com AccessMonitor / QualWeb
 * 
 * Uso:
 *   node avaliar-site.js                  -> Avalia todas as páginas reais do município
 *   node avaliar-site.js --max 50         -> Avalia no máximo 50 páginas
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// Argumentos
const args = process.argv.slice(2);
function getArg(flag, defaultValue) {
  const index = args.indexOf(flag);
  return index !== -1 && args[index + 1] ? args[index + 1] : defaultValue;
}

const maxArg = getArg('--max', null);
const MAX_PAGES = maxArg ? parseInt(maxArg, 10) : Infinity;
const START_URL = 'https://www.cm-sernancelhe.pt';
const API_BASE = 'http://localhost:3002/amp/eval/';
const REFERER = 'http://localhost:3001';

// Extensões de ficheiros que não são páginas Web
const IGNORED_EXTENSIONS = /\.(pdf|jpg|jpeg|png|gif|svg|webp|css|js|zip|rar|tar|gz|doc|docx|xls|xlsx|ppt|pptx|mp3|mp4|avi|mov|ico|woff|woff2|ttf|eot|xml|json)$/i;

// Função para descarregar o HTML da página
function fetchHtml(targetUrl) {
  return new Promise((resolve) => {
    const client = targetUrl.startsWith('https') ? https : http;
    const req = client.get(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml'
      },
      timeout: 15000
    }, (res) => {
      // Seguir redirecionamentos (301, 302, 307, 308)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        try {
          const redirectUrl = new URL(res.headers.location, targetUrl).href;
          return fetchHtml(redirectUrl).then(resolve);
        } catch (e) {
          return resolve('');
        }
      }

      if (res.statusCode !== 200) {
        return resolve('');
      }

      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });

    req.on('error', () => resolve(''));
    req.on('timeout', () => { req.destroy(); resolve(''); });
  });
}

// Normalizar URLs e filtrar rigorosamente apenas páginas reais de Sernancelhe
function normalizeUrl(rawUrl, currentUrl) {
  try {
    const parsed = new URL(rawUrl, currentUrl);

    // 1. Apenas HTTP/HTTPS
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

    // 2. GARANTIA RIGOROSA: Apenas domínio cm-sernancelhe.pt
    const host = parsed.hostname.toLowerCase();
    if (host !== 'www.cm-sernancelhe.pt' && host !== 'cm-sernancelhe.pt') {
      return null;
    }

    // Normalizar para https://www.cm-sernancelhe.pt
    parsed.protocol = 'https:';
    parsed.hostname = 'www.cm-sernancelhe.pt';
    parsed.port = '';
    parsed.hash = ''; // remover âncoras (#conteudo, #topo, etc.)

    // 3. Ficheiros estáticos e documentos (PDFs, imagens, downloads)
    if (IGNORED_EXTENSIONS.test(parsed.pathname)) return null;

    // 4. Pastas de sistema e rotas auxiliares
    const p = parsed.pathname.toLowerCase();
    if (
      p.includes('/assets/') ||
      p.includes('/uploads/') ||
      p.includes('/wp-content/') ||
      p.includes('/feed') ||
      p.includes('/rss') ||
      p.includes('/imprimir') ||
      p.includes('/print') ||
      p.includes('/login') ||
      p.includes('/admin') ||
      p.includes('/personalizar-cookies')
    ) {
      return null;
    }

    // 5. ELIMINAR QUERY STRINGS (?data=..., ?mes=..., ?ano=...)
    // É isso que criava o loop infinito do calendário com 100.000+ links repetidos!
    // As páginas reais de conteúdo têm URLs amigáveis (ex: /municipio/contactos, /pages/721).
    parsed.search = '';

    // 6. Normalizar barra final (remover para não duplicar /pagina e /pagina/)
    let cleanPath = parsed.pathname;
    if (cleanPath.length > 1 && cleanPath.endsWith('/')) {
      cleanPath = cleanPath.slice(0, -1);
    }
    parsed.pathname = cleanPath;

    return parsed.href;
  } catch (e) {
    return null;
  }
}

// Extrair links internos válidos
function extractInternalLinks(html, currentUrl) {
  const links = new Set();
  const regex = /href\s*=\s*["']([^"'#\s>]+)/gi;
  let match;

  while ((match = regex.exec(html)) !== null) {
    const cleanUrl = normalizeUrl(match[1], currentUrl);
    if (cleanUrl) links.add(cleanUrl);
  }

  return Array.from(links);
}

// Avaliar um URL na API local do AccessMonitor (QualWeb)
function evaluatePage(targetUrl) {
  return new Promise((resolve) => {
    const b64 = Buffer.from(targetUrl).toString('base64');
    const endpoint = API_BASE + encodeURIComponent(b64);

    const req = http.get(endpoint, {
      headers: {
        'Referer': REFERER,
        'User-Agent': 'AccessMonitor-Crawler/1.0'
      },
      timeout: 60000
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (res.statusCode !== 200) {
            return resolve({
              url: targetUrl,
              success: false,
              error: json.message || `HTTP ${res.statusCode}`
            });
          }

          const pageData = json.data?.data || json.data || {};
          const tot = pageData.tot || json.data?.tot || {};
          const info = tot.info || {};
          const nodes = pageData.nodes || {};

          let passed = 0;
          let failed = 0;
          let warning = 0;
          const errorsList = [];

          for (const [rule, results] of Object.entries(nodes)) {
            if (Array.isArray(results)) {
              for (const item of results) {
                if (item.verdict === 'passed') passed++;
                else if (item.verdict === 'failed') {
                  failed++;
                  if (item.description && !errorsList.includes(item.description)) {
                    errorsList.push(item.description);
                  }
                } else if (item.verdict === 'warning') {
                  warning++;
                }
              }
            }
          }

          resolve({
            url: targetUrl,
            success: true,
            title: info.title || pageData.title || targetUrl,
            score: parseFloat(info.score || pageData.score || '0'),
            conform: info.conform || '',
            passed,
            failed,
            warning,
            errorsList: errorsList.slice(0, 5) // Top 5 erros
          });
        } catch (e) {
          resolve({ url: targetUrl, success: false, error: 'Erro ao interpretar resposta JSON da API' });
        }
      });
    });

    req.on('error', (err) => resolve({ url: targetUrl, success: false, error: err.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ url: targetUrl, success: false, error: 'Timeout ao avaliar a página' });
    });
  });
}

// Gerar Relatório HTML Interativo
function generateHtmlReport(results, baseDomain, avgScore, isComplete = false) {
  // Ordenar pelas páginas com pontuação mais baixa primeiro
  const sorted = [...results].sort((a, b) => {
    if (!a.success) return 1;
    if (!b.success) return -1;
    return a.score - b.score;
  });

  const rows = sorted.map((r, i) => {
    if (!r.success) {
      return `
        <tr class="error-row">
          <td>${i + 1}</td>
          <td><a href="${r.url}" target="_blank" rel="noopener">${r.url}</a></td>
          <td><span class="badge badge-error">Falha</span></td>
          <td>-</td>
          <td>-</td>
          <td>-</td>
          <td class="text-danger"><em>${r.error}</em></td>
        </tr>`;
    }

    const scoreClass = r.score >= 9.0 ? 'score-high' : r.score >= 7.0 ? 'score-medium' : 'score-low';
    const topErrors = r.errorsList && r.errorsList.length > 0 
      ? `<ul class="error-list">${r.errorsList.map(e => `<li>${e}</li>`).join('')}</ul>`
      : '<span class="text-success">✔ Sem erros críticos</span>';

    return `
      <tr>
        <td>${i + 1}</td>
        <td>
          <a href="${r.url}" target="_blank" rel="noopener" class="page-link" title="${r.url}">
            ${(r.title || r.url).length > 55 ? (r.title || r.url).slice(0, 52) + '...' : (r.title || r.url)}
          </a>
          <br><small class="url-sub">${r.url}</small>
        </td>
        <td class="text-center"><span class="score-badge ${scoreClass}">${r.score.toFixed(1)}</span></td>
        <td class="text-center text-danger font-bold">${r.failed}</td>
        <td class="text-center text-warning font-bold">${r.warning}</td>
        <td class="text-center text-success font-bold">${r.passed}</td>
        <td class="issues-col">${topErrors}</td>
      </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="pt-PT">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Relatório de Acessibilidade - ${baseDomain}</title>
  <style>
    :root {
      --primary: #0066cc;
      --bg: #f8fafc;
      --card-bg: #ffffff;
      --text: #1e293b;
      --border: #e2e8f0;
      --success: #16a34a;
      --warning: #ca8a04;
      --danger: #dc2626;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      margin: 0;
      padding: 30px 20px;
    }
    .container {
      max-width: 1250px;
      margin: 0 auto;
    }
    header {
      background: var(--card-bg);
      border-radius: 12px;
      padding: 24px 30px;
      margin-bottom: 24px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.06);
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 20px;
    }
    h1 {
      margin: 0 0 8px 0;
      font-size: 24px;
      color: #0f172a;
    }
    p.subtitle {
      margin: 0;
      color: #64748b;
      font-size: 14px;
    }
    .stats-card {
      display: flex;
      gap: 16px;
    }
    .stat-box {
      background: #f1f5f9;
      padding: 12px 20px;
      border-radius: 8px;
      text-align: center;
    }
    .stat-box .num {
      font-size: 26px;
      font-weight: 700;
      color: #0f172a;
    }
    .stat-box .label {
      font-size: 12px;
      color: #64748b;
      text-transform: uppercase;
      font-weight: 600;
    }
    .score-high { background: #dcfce7; color: #15803d; }
    .score-medium { background: #fef9c3; color: #a16207; }
    .score-low { background: #fee2e2; color: #b91c1c; }
    .score-badge {
      display: inline-block;
      padding: 6px 14px;
      border-radius: 9999px;
      font-weight: 700;
      font-size: 16px;
    }
    .table-container {
      background: var(--card-bg);
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0,0,0,0.06);
    }
    .controls {
      padding: 16px 20px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
    }
    input#search {
      padding: 8px 14px;
      border: 1px solid var(--border);
      border-radius: 6px;
      font-size: 14px;
      width: 320px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 14px;
    }
    th {
      background: #f8fafc;
      padding: 12px 16px;
      font-weight: 600;
      color: #475569;
      border-bottom: 1px solid var(--border);
    }
    td {
      padding: 14px 16px;
      border-bottom: 1px solid var(--border);
      vertical-align: top;
    }
    tr:hover td {
      background: #f8fafc;
    }
    .text-center { text-align: center; }
    .font-bold { font-weight: 600; }
    .text-danger { color: var(--danger); }
    .text-warning { color: var(--warning); }
    .text-success { color: var(--success); }
    .page-link {
      color: var(--primary);
      text-decoration: none;
      font-weight: 600;
    }
    .page-link:hover { text-decoration: underline; }
    .url-sub {
      color: #94a3b8;
      font-size: 12px;
      word-break: break-all;
    }
    .error-list {
      margin: 0;
      padding-left: 18px;
      font-size: 12px;
      color: #475569;
    }
    .error-list li { margin-bottom: 4px; }
    .badge-error {
      background: #fee2e2;
      color: #b91c1c;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
    }
    .status-badge {
      padding: 4px 10px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
    }
    .status-live { background: #e0f2fe; color: #0369a1; }
    .status-done { background: #dcfce7; color: #15803d; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <h1>Relatório de Acessibilidade Web (WCAG 2.1)</h1>
        <p class="subtitle">
          Município: <strong>${baseDomain}</strong> | 
          Status: <span class="status-badge ${isComplete ? 'status-done' : 'status-live'}">${isComplete ? '✔ Avaliação Concluída' : '⏳ Em Avaliação...'}</span> | 
          Última atualização: ${new Date().toLocaleTimeString('pt-PT')}
        </p>
      </div>
      <div class="stats-card">
        <div class="stat-box">
          <div class="num">${results.length}</div>
          <div class="label">Páginas Analisadas</div>
        </div>
        <div class="stat-box">
          <div class="num ${avgScore >= 9.0 ? 'text-success' : avgScore >= 7.0 ? 'text-warning' : 'text-danger'}">${avgScore.toFixed(1)}</div>
          <div class="label">Média Global</div>
        </div>
      </div>
    </header>

    <div class="table-container">
      <div class="controls">
        <input type="text" id="search" placeholder="Filtrar por título ou endereço URL..." onkeyup="filterTable()">
        <small style="color: #64748b;">Apresentado por ordem de urgência (menor pontuação primeiro)</small>
      </div>
      <table id="resultsTable">
        <thead>
          <tr>
            <th width="40">#</th>
            <th>Página</th>
            <th width="100" class="text-center">Pontuação</th>
            <th width="80" class="text-center">Erros</th>
            <th width="80" class="text-center">Avisos</th>
            <th width="80" class="text-center">Aprovados</th>
            <th>Principais Não-Conformidades Detetadas</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  </div>

  <script>
    function filterTable() {
      const input = document.getElementById('search');
      const filter = input.value.toLowerCase();
      const table = document.getElementById('resultsTable');
      const tr = table.getElementsByTagName('tr');

      for (let i = 1; i < tr.length; i++) {
        const text = tr[i].textContent || tr[i].innerText;
        tr[i].style.display = text.toLowerCase().indexOf(filter) > -1 ? '' : 'none';
      }
    }
  </script>
</body>
</html>`;
}

// Guardar relatórios progressivamente no disco
function saveReports(results, baseHostname, isComplete = false) {
  let totalScore = 0;
  let countSuccess = 0;

  results.forEach(r => {
    if (r.success) {
      totalScore += r.score;
      countSuccess++;
    }
  });

  const avgScore = countSuccess > 0 ? (totalScore / countSuccess) : 0;

  // 1. Guardar CSV (com UTF-8 BOM para abrir no Microsoft Excel)
  const csvRows = [
    ['#', 'URL', 'Título', 'Pontuação', 'Erros WCAG', 'Avisos', 'Aprovados', 'Principais Não-Conformidades'].map(c => `"${c}"`).join(';')
  ];

  results.forEach((r, idx) => {
    if (r.success) {
      const errStr = (r.errorsList || []).join(' | ').replace(/"/g, '""');
      const titleStr = (r.title || '').replace(/"/g, '""');
      csvRows.push([
        idx + 1,
        `"${r.url}"`,
        `"${titleStr}"`,
        `"${r.score.toFixed(1)}"`,
        r.failed,
        r.warning,
        r.passed,
        `"${errStr}"`
      ].join(';'));
    } else {
      csvRows.push([
        idx + 1,
        `"${r.url}"`,
        `"Falha: ${r.error}"`,
        '""', '""', '""', '""', '""'
      ].join(';'));
    }
  });

  const csvPath = path.join(__dirname, 'relatorio_sernancelhe.csv');
  fs.writeFileSync(csvPath, '\uFEFF' + csvRows.join('\r\n'), 'utf8');

  // 2. Guardar HTML Dashboard
  const htmlContent = generateHtmlReport(results, baseHostname, avgScore, isComplete);
  const htmlPath = path.join(__dirname, 'relatorio_sernancelhe.html');
  fs.writeFileSync(htmlPath, htmlContent, 'utf8');

  // 3. Guardar JSON
  const jsonPath = path.join(__dirname, 'relatorio_sernancelhe.json');
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2), 'utf8');

  return { csvPath, htmlPath, jsonPath, avgScore, countSuccess };
}

// Execução Principal
async function main() {
  console.log('='.repeat(70));
  console.log('  🔍 AVALIADOR ACCESSMONITOR - MUNICÍPIO DE SERNANCELHE');
  console.log('='.repeat(70));
  console.log(`Domínio:        ${START_URL}`);
  console.log(`Backend API:    ${API_BASE}`);
  console.log(`Filtro estrito: Apenas páginas reais começadas por cm-sernancelhe.pt`);
  console.log('-'.repeat(70));

  const startParsed = new URL(START_URL);
  const baseHostname = startParsed.hostname;

  const queue = [START_URL];
  const visited = new Set();
  const results = [];

  // Se o utilizador interromper com Ctrl+C, salva o relatório atual
  process.on('SIGINT', () => {
    console.log('\n\n🛑 Processo interrompido pelo utilizador. A guardar dados recolhidos...');
    saveReports(results, baseHostname, false);
    console.log(`✔ Relatório parcial guardado com ${results.length} páginas avaliadas!`);
    process.exit(0);
  });

  console.log(`\n1. A mapear as páginas reais do site (filtrando calendários e repetições)...`);

  while (queue.length > 0 && visited.size < MAX_PAGES) {
    const currentUrl = queue.shift();
    if (visited.has(currentUrl)) continue;
    visited.add(currentUrl);

    process.stdout.write(`\r   Páginas únicas encontradas: ${visited.size} (em fila: ${queue.length})...   `);

    try {
      const html = await fetchHtml(currentUrl);
      if (html) {
        const discovered = extractInternalLinks(html, currentUrl);
        for (const link of discovered) {
          if (!visited.has(link) && !queue.includes(link)) {
            queue.push(link);
          }
        }
      }
    } catch (e) {
      // Ignorar erros no download de HTML
    }
  }

  const urlsToEvaluate = Array.from(visited);
  console.log(`\n\n✔ Mapeamento concluído com sucesso: ${urlsToEvaluate.length} páginas reais encontradas!`);
  console.log('\n2. A iniciar avaliação detalhada no AccessMonitor (QualWeb + Chromium)...');
  console.log('💡 Dica: Os relatórios CSV e HTML são atualizados a cada página avaliada.\n');
  console.log('-'.repeat(70));

  const startTime = Date.now();

  for (let i = 0; i < urlsToEvaluate.length; i++) {
    const pageUrl = urlsToEvaluate[i];
    const indexStr = `[${i + 1}/${urlsToEvaluate.length}]`;
    process.stdout.write(`${indexStr} A avaliar: ${pageUrl.slice(0, 50)}... `);

    const res = await evaluatePage(pageUrl);
    results.push(res);

    if (res.success) {
      console.log(`✔ Nota: ${res.score.toFixed(1)} (${res.failed} erros, ${res.warning} avisos) - "${(res.title || '').slice(0, 26)}"`);
    } else {
      console.log(`✖ Falha: ${res.error}`);
    }

    // Salva progressivamente após cada página
    saveReports(results, baseHostname, i === urlsToEvaluate.length - 1);
  }

  const durationMin = ((Date.now() - startTime) / 60000).toFixed(1);
  const { csvPath, htmlPath, jsonPath, avgScore, countSuccess } = saveReports(results, baseHostname, true);

  console.log('\n' + '='.repeat(70));
  console.log('  🎉 AVALIAÇÃO CONCLUÍDA');
  console.log('='.repeat(70));
  console.log(`Duração:                    ${durationMin} minutos`);
  console.log(`Páginas Avaliadas:          ${results.length}`);
  console.log(`Páginas com Sucesso:        ${countSuccess}`);
  console.log(`Média Global do Município:  ${avgScore.toFixed(2)} / 10`);
  console.log('-'.repeat(70));
  console.log(`📄 Relatório Visual (Dashboard HTML): ${htmlPath}`);
  console.log(`📊 Folha de Cálculo (Excel CSV):     ${csvPath}`);
  console.log(`💾 Ficheiro de Dados (JSON):         ${jsonPath}\n`);
}

main().catch(console.error);
