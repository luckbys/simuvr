# SimuVR — notas para quem for mexer no projeto

Simulador de carro VR (Three.js + WebXR + Rapier), cidade noturna de cultura tuning. UI e textos em **PT‑BR**.

## Comandos

- `npm run dev` (HTTPS autoassinado) · `npm run build` (tsc + vite) · `npm run typecheck`
- `npm test` (vitest, só `tests/unit`) · `npm run test:e2e` (precisa de `npm run build` antes; usa `vite preview`)
- E2E individuais: `test:e2e:desktop|quality|garage|audiofx|vr|vr-walk`. Rodam Chromium headless com WebGL por software
  (cada quadro leva centenas de ms): **espere por condição/quadros, nunca por `waitForTimeout` curto**.

## Regras que custaram caro

- **Física:** referencial do chassi com −Z à frente. Reação de apoio vai na **normal do solo** no ponto de contato
  (no eixo do chassi o carro parado desliza). Motor+embreagem+diferencial+rodas são resolvidos **implicitamente**
  (3×3); trocar por Euler explícito reintroduz instabilidade a baixa velocidade. A embreagem automática é
  proporcional ao torque do motor (a versão por rotação "caçava"). Não aloque arrays em `Vehicle.update`.
- **Three/WebXR:** sem pós-processamento (não funciona em XR): bloom é halo aditivo billboard
  (`fx/billboard.ts`). `renderer.info.autoReset = false` (o retrovisor faz um 2º render): zere por quadro.
  `mergeGeometries` exige atributos iguais (remova `uv` quando misturar loft e caixas).
- **Overdraw aditivo** é o que mais custa no Quest: partículas pequenas, poucas, e com fade perto da câmera.
- **IWER:** instale com `{ forceInstall: true }`; o controle esquerdo usa `x-button`/`y-button`, o direito
  `a-button`/`b-button`; o espaço *grip* tem deslocamento (compense nos testes de volante).
- **Qualidade:** `?q=low|high`. Tudo que for caro (SpotLight, MeshPhysicalMaterial, retrovisor, chuva) tem flag em
  `core/quality.ts`; o `PerfGovernor` degrada em VR.
- Ao adicionar um controle de tuning, edite só `garage/schema.ts`: PC e VR o exibem sozinhos.

## Fora do escopo da v1

Corrida/IA de oponentes, tráfego, multijogador, desgaste de pneu, modelos 3D importados (a interface do carro
aceita GLB com nós nomeados, mas não há carregador ainda).
