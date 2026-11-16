# AccessMonitor - Suite Completa (Frontend + Backend + Crawler)

Solução completa para validação de acessibilidade web de acordo com as normas **WCAG 2.1 (W3C)** e regras **ACT Rules**, baseada no motor **QualWeb** da FCUL e na plataforma oficial da **AMA (Agência para a Modernização Administrativa)**.

---

## 📁 Estrutura do Projeto

- **`AccessMonitor-3.0.5/`**: Interface web oficial em React (Single Page Application).
- **`accessmonitor-backend/`**: Servidor de avaliação em NestJS que executa o motor QualWeb e um browser Chromium *headless* via Docker.
- **`avaliar-site.js`**: Script de auditoria em massa que mapeia automaticamente um domínio (ex: autarquias/municípios) e gera relatórios em HTML e Excel (CSV).

---

## 🚀 Como Iniciar

### 1. Iniciar o Backend (Docker)
O backend corre num contentor Docker com Chromium e QualWeb na porta `3002`:

```bash
# Iniciar o contentor já criado
docker start accessmonitor-backend

# (Caso precise de reconstruir a imagem no futuro):
cd accessmonitor-backend
docker build -t accessmonitor-backend .
docker run -d --name accessmonitor-backend --restart unless-stopped --env-file .env -p 3002:3000 accessmonitor-backend
```

O endpoint da API de avaliação fica acessível em: `http://localhost:3002/amp/eval/`

### 2. Iniciar o Frontend (Interface Web)
Para aceder à interface visual no browser:

```bash
npm start
```

A aplicação abrirá no browser em: **http://localhost:3001**

### 3. Executar Avaliação em Massa de um Site
Para avaliar automaticamente todas as páginas reais de um domínio (com filtros anti-loops de calendário e exportação para HTML/Excel):

```bash
# Avaliar todas as páginas de Sernancelhe:
node avaliar-site.js

# Ou definir um limite máximo de páginas:
node avaliar-site.js --max 50
```

---

## 📊 Relatórios Gerados
- **`relatorio_sernancelhe.html`**: Dashboard visual interativo com ordenação das páginas com menor pontuação e pesquisa.
- **`relatorio_sernancelhe.csv`**: Folha de cálculo formatada com UTF-8 BOM para abrir diretamente no Microsoft Excel.
- **`relatorio_sernancelhe.json`**: Dados brutos para integração técnica.
