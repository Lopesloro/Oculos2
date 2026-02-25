/**
 * ============================================================
 * COMO SALVAR DADOS EM CADA TABELA
 * ============================================================
 * Guia rápido com exemplos práticos
 */

const { db, withTransaction, Repository } = require('./db');
const bcrypt = require('bcryptjs');

// ============================================================
// 1. SALVAR USUÁRIO
// ============================================================

function salvarUsuario() {
    const repo = new Repository(db);
    
    const usuario = repo.createUser({
        nome: 'João Silva',
        email: 'joao@email.com',
        cpf: '12345678901',
        senha_hash: bcrypt.hashSync('senha123', 10),
        telefone: '(11) 99999-8888'
    });
    
    console.log('Usuário salvo! ID:', usuario.id, 'UUID:', usuario.uuid);
    return usuario.id;
}

// SQL equivalente:
// INSERT INTO usuarios (uuid, nome, email, cpf, senha_hash, telefone)
// VALUES ('uuid-aqui', 'João Silva', 'joao@email.com', '12345678901', 'hash-aqui', '(11) 99999-8888')


// ============================================================
// 2. SALVAR ENDEREÇO
// ============================================================

function salvarEndereco(usuarioId) {
    const repo = new Repository(db);
    
    const endereco = repo.createAddress({
        usuario_id: usuarioId,
        cep: '01310-100',
        logradouro: 'Avenida Paulista',
        numero: '1000',
        complemento: 'Sala 501',
        bairro: 'Bela Vista',
        cidade: 'São Paulo',
        estado: 'SP',
        tipo: 'entrega',
        padrao: 1
    });
    
    console.log('Endereço salvo! ID:', endereco.id);
    return endereco.id;
}

// SQL equivalente:
// INSERT INTO enderecos (usuario_id, cep, logradouro, numero, complemento, bairro, cidade, estado, tipo, padrao)
// VALUES (1, '01310-100', 'Avenida Paulista', '1000', 'Sala 501', 'Bela Vista', 'São Paulo', 'SP', 'entrega', 1)


// ============================================================
// 3. SALVAR PRODUTO
// ============================================================

function salvarProduto() {
    const stmt = db.prepare(`
        INSERT INTO produtos (sku, nome, descricao, preco_unitario, estoque, especificacoes)
        VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    const result = stmt.run(
        'PROD-001',                    // SKU único
        'BlueShield Pro',              // Nome
        'Óculos anti luz azul',        // Descrição
        269.00,                        // Preço
        100,                           // Estoque
        JSON.stringify({               // Especificações em JSON
            peso: '22g',
            material: 'TR90',
            protecao: 'UV400'
        })
    );
    
    console.log('Produto salvo! ID:', result.lastInsertRowid);
    return result.lastInsertRowid;
}


// ============================================================
// 4. SALVAR PEDIDO COMPLETO (TRANSAÇÃO)
// ============================================================

function salvarPedido(dadosCliente) {
    return withTransaction((repo) => {
        
        // 1. Criar ou buscar usuário
        let usuario = repo.getUserByEmail(dadosCliente.email);
        if (!usuario) {
            const novo = repo.createUser({
                nome: dadosCliente.nome,
                email: dadosCliente.email,
                cpf: dadosCliente.cpf,
                senha_hash: bcrypt.hashSync('temp123', 10),
                telefone: dadosCliente.telefone
            });
            usuario = repo.getUserById(novo.id);
        }
        
        // 2. Criar endereço
        const endereco = repo.createAddress({
            usuario_id: usuario.id,
            cep: dadosCliente.cep,
            logradouro: dadosCliente.endereco,
            numero: dadosCliente.numero,
            complemento: dadosCliente.complemento,
            bairro: dadosCliente.bairro,
            cidade: dadosCliente.cidade,
            estado: dadosCliente.estado,
            tipo: 'entrega',
            padrao: 1
        });
        
        // 3. Buscar produto
        const produto = repo.getProductBySku('BLUESHIELD-PRO-001');
        
        // 4. Criar pedido
        const pedido = repo.createOrder({
            usuario_id: usuario.id,
            endereco_id: endereco.id,
            subtotal: produto.preco_unitario * dadosCliente.quantidade,
            frete: 0,
            desconto: 0,
            total: produto.preco_unitario * dadosCliente.quantidade,
            metodo_pagamento: 'pix',
            observacoes_cliente: dadosCliente.observacoes
        });
        
        // 5. Adicionar item
        repo.addOrderItem({
            pedido_id: pedido.id,
            produto_id: produto.id,
            sku: produto.sku,
            nome: produto.nome,
            quantidade: dadosCliente.quantidade,
            preco_unitario: produto.preco_unitario,
            variacao: null
        });
        
        // 6. Atualizar estoque
        repo.updateStock(produto.id, dadosCliente.quantidade);
        
        return {
            numero_pedido: pedido.numero_pedido,
            total: pedido.total
        };
    });
}

// Como usar:
// const resultado = salvarPedido({
//     nome: 'João Silva',
//     email: 'joao@email.com',
//     cpf: '12345678901',
//     telefone: '(11) 99999-8888',
//     cep: '01001-000',
//     endereco: 'Rua Augusta',
//     numero: '500',
//     complemento: 'Apto 123',
//     bairro: 'Consolação',
//     cidade: 'São Paulo',
//     estado: 'SP',
//     quantidade: 2,
//     observacoes: 'Entregar após 18h'
// });


// ============================================================
// 5. ATUALIZAR STATUS DO PEDIDO
// ============================================================

function atualizarStatusPedido(pedidoId, novoStatus) {
    const repo = new Repository(db);
    
    const resultado = repo.updateOrderStatus(
        pedidoId,
        novoStatus,           // 'pendente', 'pago', 'enviado', 'entregue', 'cancelado'
        'Pagamento confirmado', // Observação
        null                    // Usuário responsável (null = sistema)
    );
    
    console.log(`Status: ${resultado.statusAnterior} → ${resultado.novoStatus}`);
}


// ============================================================
// 6. REGISTRAR AUDITORIA
// ============================================================

function registrarAuditoria() {
    const repo = new Repository(db);
    
    repo.logAudit({
        tabela: 'usuarios',
        registro_id: 1,
        acao: 'UPDATE',
        dados_anteriores: { nome: 'João' },
        dados_novos: { nome: 'João Silva' },
        usuario_id: 1,
        ip_address: '192.168.1.1',
        endpoint: '/api/usuarios/1',
        metodo_http: 'PUT'
    });
    
    console.log('Auditoria registrada!');
}


// ============================================================
// EXEMPLO COMPLETO DE USO
// ============================================================

function exemploCompleto() {
    console.log('=== EXEMPLO COMPLETO ===\n');
    
    // Dados do cliente
    const cliente = {
        nome: 'Maria Oliveira',
        email: 'maria@email.com',
        cpf: '98765432100',
        telefone: '(11) 98888-7777',
        cep: '01310-100',
        endereco: 'Avenida Paulista',
        numero: '1000',
        complemento: 'Sala 501',
        bairro: 'Bela Vista',
        cidade: 'São Paulo',
        estado: 'SP',
        quantidade: 1,
        observacoes: 'Presente de aniversário'
    };
    
    try {
        // Salvar pedido completo
        const pedido = salvarPedido(cliente);
        console.log('✅ Pedido criado:', pedido.numero_pedido);
        console.log('💰 Total: R$', pedido.total.toFixed(2));
        
    } catch (erro) {
        console.error('❌ Erro:', erro.message);
    }
}

// Executar exemplo (descomente para testar)
// exemploCompleto();

module.exports = {
    salvarUsuario,
    salvarEndereco,
    salvarProduto,
    salvarPedido,
    atualizarStatusPedido,
    registrarAuditoria,
    exemploCompleto
};
