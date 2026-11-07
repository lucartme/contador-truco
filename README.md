# Truco — marcador de pontos

Marcador de truco paulista: placar, truco/seis/nove/doze, mão de onze, mão cega,
quem embaralha, apostas, histórico por confronto e compartilhamento no WhatsApp.
Funciona offline e guarda tudo no próprio celular.

## Abrir no celular
**https://lucartme.github.io/contador-truco/**

### Instalar como app
- **iPhone (Safari):** abre o link → botão **Compartilhar** (quadrado com seta) →
  **Adicionar à Tela de Início** → **Adicionar**.
- **Android (Chrome):** abre o link → menu **⋮** → **Instalar app** (ou "Adicionar à tela inicial").

Depois é só abrir pelo ícone "Truco", como qualquer app.

## Atualizar
Depois de mudar os arquivos, aumente a versão em `service-worker.js`
(`const CACHE = 'truco-v3'`, etc.) e rode:

```
git add -A && git commit -m "atualização" && git push
```

O app no celular atualiza sozinho (às vezes precisa fechar e abrir duas vezes).

## Backup
Os dados ficam no celular. Use **☰ → Exportar / Importar dados** para salvar um backup.
