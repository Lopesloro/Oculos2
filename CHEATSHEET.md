# Cheatsheet - Como Salvar no Banco

## 1. Salvar Usuário

```javascript
const { Repository } = require('./db');
const bcrypt = require('bcryptjs');

const repo = new Repository(db);

const usuario = repo.createUser({
    nome: 'João Silva',
    email: 'joao@email.com',
    cpf: '12345678901',
    senha_hash: bcrypt.hashSync('senha123', 10),
    telefone: '(11) 99999-8888'
});

// Retorna: { id: 1, uuid: '550e8400-e29b-41d4-a716-446655440000' }
```

---

## 2. Salvar Endereço

```javascript
const endereco = repo.createAddress({
    usuario_id: 1,                    // ID do usuário
    cep: '01310-100',
    logradouro: 'Avenida Paulista',
    numero: '1000',
    complemento: 'Sala 501',
    bairro: 'Bela Vista',
    cidade: 'São Paulo',
    estado: 'SP',
    tipo: 'entrega',                  // 'entrega', 'cobranca', 'ambos'
    padrao: 1                         // 1 = endereço padrão
});

// Retorna: { id: 1 }
```

---

## 3. Salvar Produto

```javascript
const stmt = db.prepare(`
    INSERT INTO produtos (sku, nome, descricao, preco_unitario, estoque, especificacoes)
    VALUES (?, ?, ?, ?, ?, ?)
`);

const result = stmt.run(
    'PROD-001',                        // SKU único
    'BlueShield Pro',                  // Nome
    'Óculos anti luz azul',            // Descrição
    299.00,                            // Preço
    100,                               // Estoque
    JSON.stringify({                   // JSON com specs
        peso: '22g',
        material: 'TR90'
    })
);

// Retorna: { lastInsertRowid: 1 }
```

---

## 4. Salvar Pedido Completo (COM TRANSAÇÃO)

```javascript
const { withTransaction } = require('./db');

const pedido = withTransaction((repo) => {
    
    // 1. Criar usuário (ou buscar se já existe)
    const usuario = repo.createUser({
        nome: 'João Silva',
        email: 'joao@email.com',
        cpf: '12345678901',
        senha_hash: bcrypt.hashSync('temp123', 10),
        telefone: '(11) 99999-8888'
    });
    
    // 2. Criar endereço
    const endereco = repo.createAddress({
        usuario_id: usuario.id,
        cep: '01001-000',
        logradouro: 'Rua Augusta',
        numero: '500',
        bairro: 'Consolação',
        cidade: 'São Paulo',
        estado: 'SP',
        tipo: 'entrega',
        padrao: 1
    });
    
    // 3. Buscar produto
    const produto = repo.getProductBySku('BLUESHIELD-PRO-001');
    
    // 4. Criar pedido
    const pedido = repo.createOrder({
        usuario_id: usuario.id,
        endereco_id: endereco.id,
        subtotal: 299.00,
        frete: 0,
        desconto: 0,
        total: 299.00,
        metodo_pagamento: 'pix',
        observacoes_cliente: 'Entregar após 18h'
    });
    
    // 5. Adicionar item
    repo.addOrderItem({
        pedido_id: pedido.id,
        produto_id: produto.id,
        sku: produto.sku,
        nome: produto.nome,
        quantidade: 1,
        preco_unitario: produto.preco_unitario,
        variacao: null
    });
    
    // 6. Diminuir estoque
    repo.updateStock(produto.id, 1);
    
    return pedido;  // Retorna número do pedido
});

console.log('Pedido:', pedido.numero_pedido);  // BSP-20250222-0001
```

---

## 5. Atualizar Status do Pedido

```javascript
const resultado = repo.updateOrderStatus(
    1,                          // ID do pedido
    'pago',                     // Novo status
    'Pagamento confirmado',     // Observação
    null                        // Usuário responsável
);

// Status possíveis:
// 'pendente', 'aguardando_pagamento', 'pago', 'processando', 
// 'enviado', 'entregue', 'cancelado', 'reembolsado'
```

---

## 6. Registrar Auditoria

```javascript
repo.logAudit({
    tabela: 'pedidos',
    registro_id: 1,
    acao: 'UPDATE',              // INSERT, UPDATE, DELETE, LOGIN
    dados_anteriores: { status: 'pendente' },
    dados_novos: { status: 'pago' },
    usuario_id: 1,
    ip_address: '192.168.1.1',
    endpoint: '/api/pedidos/1',
    metodo_http: 'PUT'
});
```

---

## SQL Direto (se precisar)

### Inserir usuário
```sql
INSERT INTO usuarios (uuid, nome, email, cpf, senha_hash, telefone)
VALUES ('uuid-aqui', 'João', 'joao@email.com', '12345678901', 'hash-aqui', '(11) 99999-8888');
```

### Inserir endereço
```sql
INSERT INTO enderecos (usuario_id, cep, logradouro, numero, cidade, estado, tipo, padrao)
VALUES (1, '01001-000', 'Rua Augusta', '500', 'São Paulo', 'SP', 'entrega', 1);
```

### Inserir produto
```sql
INSERT INTO produtos (sku, nome, descricao, preco_unitario, estoque)
VALUES ('PROD-001', 'BlueShield Pro', 'Óculos anti luz azul', 299.00, 100);
```

### Inserir pedido
```sql
INSERT INTO pedidos (numero_pedido, usuario_id, endereco_id, subtotal, frete, desconto, total, metodo_pagamento)
VALUES ('BSP-20250222-0001', 1, 1, 299.00, 0, 0, 299.00, 'pix');
```

### Inserir item do pedido
```sql
INSERT INTO pedido_itens (pedido_id, produto_id, sku, nome, quantidade, preco_unitario, subtotal)
VALUES (1, 1, 'BLUESHIELD-PRO-001', 'BlueShield Pro', 1, 299.00, 299.00);
```

---

## Dicas Importantes

1. **Sempre use transações** para operações que envolvem múltiplas tabelas
2. **O Repository** já tem métodos prontos para as operações mais comuns
3. **Soft delete**: Use `repo.softDeleteUser(id)` ao invés de DELETE
4. **Número do pedido** é gerado automaticamente (formato: BSP-YYYYMMDD-XXXX)
5. **UUID** é gerado automaticamente para usuários
