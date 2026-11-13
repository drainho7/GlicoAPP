# GlicoApp — MVP de diagnóstico BLE

Fase 1: scan sem filtro, conexão, descoberta GATT, teste de autenticação.
Fase 2: importação pelo Glucose Service (0x1808) via RACP `01 01` ("AQE="), só se o GATT confirmar.

## Rodar no Android (celular físico, Development Build)

```bash
npx expo prebuild --platform android
npx expo run:android
```

Com o app instalado e o celular no mesmo Wi-Fi: `npx expo start --dev-client`.

## Testes

```bash
npm test
npm run typecheck
```

## Roteiro com o medidor

1. Aba **Scan**: ligue o Bluetooth do medidor e toque no dispositivo que aparecer.
2. Aba **Diagnóstico** → *Conectar e descobrir GATT*. Procure `1808` e `2A52`.
3. Se o medidor exigir PIN, *Testar autenticação* faz o SO pedir o PIN.
4. Se `1808` for confirmado: *Importar histórico* e compare a última leitura com o visor.
5. Se não aparecer: o diagnóstico lista os serviços encontrados (nada é escrito neles).
