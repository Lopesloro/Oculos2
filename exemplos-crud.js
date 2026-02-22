/**
 * ============================================================
 * BLUE SHIELD PRO - EXEMPLOS DE CRUD
 * ============================================================
 * Exemplos práticos de como salvar, consultar, atualizar e
 * deletar dados em cada tabela do banco
 */

const { db, withTransaction, Repository, generateUUID } = require('./db');
const bcrypt = require('bcryptjs');

// ============================================================
// 1. USUÁRIOS
// ============================================================

/**
 * Criar novo usuário
 */
function exemploCriarUsuario() {
    const repo = new Repository(db);
    
    const novoUsuario = repo.createUser({
        nome: 'Maria Oliveira',
        email: 'maria@email.com',
        cpf: '98765432100',
        senha_hash: bcrypt.hashSync('senha123', 10),
        telefone: '(11) 98888-7777'
    });
    
    console.log('Usuário criado:', novoUsuario);
    // Retorno: { id: 1, uuid: '550e8400-e29b-41d4-a716-446655440000' }
    return novoUsuario;
}

/**
 * Buscar usuário por email
 */
function exemploBuscarUsuarioPorEmail(email) {
    const repo = new Repository(db);
    const usuario = repo.getUserByEmail(email);
    console.log('Usuário encontrado:', usuario);
    return usuario;
}

/**
 * Buscar usuário por CPF
 */
function exemploBuscarUsuarioPorCPF(cpf) {
    const repo = new Repository(db);
    const usuario = repo.getUserByCPF(cpf);
    console.log('Usuário por CPF:', usuario);
    return usuario;
}

/**
 * Atualizar último login
 */
function exemploAtualizarLogin(userId) {
    const repo = new Repository(db);
    repo.updateUserLogin(userId);
    console.log('Login atualizado para usuário:', userId);
}

/**
 * Soft delete de usuário (não remove, apenas marca)
 */
function exemploDeletarUsuario(userId) {
    const repo = new Repository(db);
    repo.softDeleteUser(userId);
    console.log('Usuário marcado como deletado:', userId);
}

// ============================================================
// 2. ENDEREÇOS
// ============================================================

/**
 * Criar endereço para um usuário
 */
function exemploCriarEndereco(usuarioId) {
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
        padrao: 1  // Define como endereço padrão
    });
    
    console.log('Endereço criado:', endereco);
    return endereco;
}

/**
 * Listar endereços de um usuário
 */
function exemploListarEnderecos(usuarioId) {
    const repo = new Repository(db);
    const enderecos = repo.getAddressesByUser(usuarioId);
    console.log('Endereços do usuário:', enderecos);
    return enderecos;
}

/**
 * Buscar endereço padrão
 */
function exemploBuscarEnderecoPadrao(usuarioId) {
    const repo = new Repository(db);
    const endereco = repo.getDefaultAddress(usuarioId);
    console.log('Endereço padrão:', endereco);
    return endereco;
}

// ============================================================
// 3. PRODUTOS
// ============================================================

/**
 * Inserir novo produto
 */
function exemploInserirProduto() {
    const stmt = db.prepare(`
        INSERT INTO produtos (sku, nome, descricao, preco_unitario, estoque, especificacoes)
        VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    const result = stmt.run(
        'BLUESHIELD-LITE-001',
        'BlueShield Lite',
        'Versão compacta do óculos anti luz azul',
        199.00,
        500,
        JSON.stringify({
            peso: '18g',
            material_armacao: 'TR90',
            material_lente: 'Policarbonato',
            protecao: 'UV400'
        })
    );
    
    console.log('Produto inserido, ID:', result.lastInsertRowid);
    return result.lastInsertRowid;
}

/**
 * Buscar produto por SKU
 */
function exemploBuscarProduto(sku) {
    const repo = new Repository(db);
    const produto = repo.getProductBySku(sku);
    console.log('Produto encontrado:', produto);
    return produto;
}

/**
 * Atualizar estoque
 */
function exemploAtualizarEstoque(produtoId, quantidadeVendida) {
    const repo = new Repository(db);
    repo.updateStock(produtoId, quantidadeVendida);
    console.log(`Estoque do produto ${produtoId} reduzido em ${quantidadeVendida}`);
}

/**
 * Listar todos os produtos ativos
 */
function exemploListarProdutos() {
    const produtos = db.prepare(`
        SELECT id, sku, nome, preco_unitario, estoque, ativo
        FROM produtos 
        WHERE deletado_em IS NULL AND ativo = 1
        ORDER BY nome
    `).all();
    
    console.log('Produtos:', produtos);
    return produtos;
}

// ============================================================
// 4. PEDIDOS (COM TRANSAÇÃO)
// ============================================================

/**
 * Criar pedido completo com transação
 * Garante que tudo seja salvo ou nada seja salvo
 */
function exemploCriarPedidoCompleto(dados) {
    try {
        const resultado = withTransaction((repo) => {
            // 1. Buscar ou criar usuário
            let usuario = repo.getUserByEmail(dados.email);
            
            if (!usuario) {
                const senhaTemp = Math.random().toString(36).slice(-10);
                const novoUser = repo.createUser({
                    nome: dados.nome,
                    email: dados.email,
                    cpf: dados.cpf,
                    senha_hash: bcrypt.hashSync(senhaTemp, 10),
                    telefone: dados.telefone
                });
                usuario = repo.getUserById(novoUser.id);
            }
            
            // 2. Criar endereço
            const endereco = repo.createAddress({
                usuario_id: usuario.id,
                cep: dados.cep,
                logradouro: dados.endereco,
                numero: dados.numero,
                complemento: dados.complemento,
                bairro: dados.bairro,
                cidade: dados.cidade,
                estado: dados.estado,
                tipo: 'entrega',
                padrao: 1
            });
            
            // 3. Buscar produto
            const produto = repo.getProductBySku('BLUESHIELD-PRO-001');
            if (!produto) throw new Error('Produto não encontrado');
            if (produto.estoque < dados.quantidade) throw new Error('Estoque insuficiente');
            
            // 4. Calcular valores
            const subtotal = produto.preco_unitario * dados.quantidade;
            const frete = 0;
            const desconto = 0;
            const total = subtotal + frete - desconto;
            
            // 5. Criar pedido
            const pedido = repo.createOrder({
                usuario_id: usuario.id,
                endereco_id: endereco.id,
                subtotal,
                frete,
                desconto,
                total,
                metodo_pagamento: 'pix',
                observacoes_cliente: dados.observacoes
            });
            
            // 6. Adicionar item ao pedido
            repo.addOrderItem({
                pedido_id: pedido.id,
                produto_id: produto.id,
                sku: produto.sku,
                nome: produto.nome,
                quantidade: dados.quantidade,
                preco_unitario: produto.preco_unitario,
                variacao: null
            });
            
            // 7. Atualizar estoque
            repo.updateStock(produto.id, dados.quantidade);
            
            // 8. Log de auditoria
            repo.logAudit({
                tabela: 'pedidos',
                registro_id: pedido.id,
                acao: 'INSERT',
                dados_novos: { numero_pedido: pedido.numero_pedido, total },
                usuario_id: usuario.id,
                ip_address: dados.ip,
                endpoint: '/checkout',
                metodo_http: 'POST'
            });
            
            return {
                pedido,
                usuario,
                total
            };
        });
        
        console.log('✅ Pedido criado com sucesso:', resultado.pedido.numero_pedido);
        return resultado;
        
    } catch (error) {
        console.error('❌ Erro ao criar pedido:', error.message);
        throw error;
    }
}

// ============================================================
// 5. CONSULTAR PEDIDO
// ============================================================

/**
 * Buscar pedido completo com itens
 */
function exemploBuscarPedidoCompleto(numeroPedido) {
    const repo = new Repository(db);
    
    // Dados do pedido
    const pedido = db.prepare(`
        SELECT 
            p.*,
            u.nome as cliente_nome,
            u.email as cliente_email,
            u.telefone as cliente_telefone,
            e.cep,
            e.logradouro,
            e.numero,
            e.complemento,
            e.bairro,
            e.cidade,
            e.estado
        FROM pedidos p
        JOIN usuarios u ON p.usuario_id = u.id
        JOIN enderecos e ON p.endereco_id = e.id
        WHERE p.numero_pedido = ?
    `).get(numeroPedido);
    
    if (!pedido) {
        console.log('Pedido não encontrado');
        return null;
    }
    
    // Itens do pedido
    const itens = repo.getOrderItems(pedido.id);
    
    // Histórico de status
    const historico = db.prepare(`
        SELECT * FROM pedido_historico 
        WHERE pedido_id = ? 
        ORDER BY criado_em DESC
    `).all(pedido.id);
    
    const pedidoCompleto = {
        ...pedido,
        itens,
        historico
    };
    
    console.log('Pedido completo:', pedidoCompleto);
    return pedidoCompleto;
}

// ============================================================
// 6. ATUALIZAR STATUS DO PEDIDO
// ============================================================

/**
 * Atualizar status do pedido com histórico
 */
function exemploAtualizarStatusPedido(pedidoId, novoStatus, observacao) {
    const repo = new Repository(db);
    
    const resultado = repo.updateOrderStatus(
        pedidoId,
        novoStatus,
        observacao,
        null  // usuário responsável (null = sistema)
    );
    
    console.log(`Status alterado: ${resultado.statusAnterior} → ${resultado.novoStatus}`);
    return resultado;
}

// ============================================================
// 7. AUDITORIA
// ============================================================

/**
 * Registrar log de auditoria manual
 */
function exemploRegistrarAuditoria(dados) {
    const repo = new Repository(db);
    
    repo.logAudit({
        tabela: dados.tabela,
        registro_id: dados.registro_id,
        acao: dados.acao,  // 'INSERT', 'UPDATE', 'DELETE', 'LOGIN', etc
        dados_anteriores: dados.dados_anteriores,
        dados_novos: dados.dados_novos,
        usuario_id: dados.usuario_id,
        ip_address: dados.ip,
        user_agent: dados.user_agent,
        endpoint: dados.endpoint,
        metodo_http: dados.metodo_http
    });
    
    console.log('Auditoria registrada');
}

/**
 * Consultar logs de auditoria
 */
function exemploConsultarAuditoria(tabela, registroId) {
    const logs = db.prepare(`
        SELECT 
            a.*,
            u.nome as usuario_nome
        FROM audit_logs a
        LEFT JOIN usuarios u ON a.usuario_id = u.id
        WHERE a.tabela = ? AND a.registro_id = ?
        ORDER BY a.criado_em DESC
    `).all(tabela, registroId);
    
    console.log(`Logs de auditoria para ${tabela}[${registroId}]:`, logs);
    return logs;
}

// ============================================================
// 8. ESTATÍSTICAS
// ============================================================

/**
 * Dashboard com estatísticas
 */
function exemploEstatisticas() {
    const repo = new Repository(db);
    const stats = repo.getDashboardStats();
    
    console.log('=== ESTATÍSTICAS DO SISTEMA ===');
    console.log(`Total de usuários: ${stats.totalUsuarios}`);
    console.log(`Pedidos hoje: ${stats.pedidosHoje}`);
    console.log(`Total em vendas: R$ ${stats.totalVendas.toFixed(2)}`);
    console.log('Pedidos por status:', stats.pedidosPorStatus);
    console.log('Produtos com estoque baixo:', stats.estoqueBaixo);
    
    return stats;
}

// ============================================================
// 9. EXEMPLO COMPLETO DE FLUXO
// ============================================================

/**
 * Fluxo completo: Cliente faz uma compra
 */
async function exemploFluxoCompleto() {
    console.log('\n=== EXEMPLO DE FLUXO COMPLETO ===\n');
    
    // Dados do cliente
    const dadosCliente = {
        nome: 'João Silva',
        email: 'joao.silva@email.com',
        cpf: '12345678901',
        telefone: '(11) 99999-8888',
        cep: '01001-000',
        endereco: 'Rua Augusta',
        numero: '500',
        complemento: 'Apto 123',
        bairro: 'Consolação',
        cidade: 'São Paulo',
        estado: 'SP',
        quantidade: 2,
        observacoes: 'Entregar após as 18h',
        ip: '192.168.1.1'
    };
    
    try {
        // 1. Criar pedido
        const resultado = exemploCriarPedidoCompleto(dadosCliente);
        console.log('\n✅ Pedido criado:', resultado.pedido.numero_pedido);
        console.log('💰 Total: R$', resultado.total.toFixed(2));
        
        // 2. Consultar pedido
        console.log('\n📋 Consultando pedido...');
        const pedidoCompleto = exemploBuscarPedidoCompleto(resultado.pedido.numero_pedido);
        
        // 3. Atualizar status para "pago"
        console.log('\n💳 Atualizando status para PAGO...');
        exemploAtualizarStatusPedido(
            resultado.pedido.id,
            'pago',
            'Pagamento confirmado via PIX'
        );
        
        // 4. Ver estatísticas
        console.log('\n📊 Estatísticas:');
        exemploEstatisticas();
        
        // 5. Ver auditoria
        console.log('\n🔍 Logs de auditoria do pedido:');
        exemploConsultarAuditoria('pedidos', resultado.pedido.id);
        
    } catch (error) {
        console.error('❌ Erro no fluxo:', error.message);
    }
}

// ============================================================
// 10. QUERIES PERSONALIZADAS ÚTEIS
// ============================================================

/**
 * Pedidos do dia com detalhes
 */
function queryPedidosDoDia() {
    return db.prepare(`
        SELECT 
            p.numero_pedido,
            p.total,
            p.status,
            p.criado_em,
            u.nome as cliente,
            u.email
        FROM pedidos p
        JOIN usuarios u ON p.usuario_id = u.id
        WHERE DATE(p.criado_em) = DATE('now')
        ORDER BY p.criado_em DESC
    `).all();
}

/**
 * Top clientes por valor gasto
 */
function queryTopClientes() {
    return db.prepare(`
        SELECT 
            u.nome,
            u.email,
            COUNT(p.id) as total_pedidos,
            SUM(p.total) as total_gasto
        FROM usuarios u
        JOIN pedidos p ON u.id = p.usuario_id
        WHERE p.status IN ('pago', 'enviado', 'entregue')
        AND u.deletado_em IS NULL
        GROUP BY u.id
        ORDER BY total_gasto DESC
        LIMIT 10
    `).all();
}

/**
 * Produtos mais vendidos
 */
function queryProdutosMaisVendidos() {
    return db.prepare(`
        SELECT 
            pi.sku,
            pi.nome,
            SUM(pi.quantidade) as total_vendido,
            SUM(pi.subtotal) as total_receita
        FROM pedido_itens pi
        JOIN pedidos p ON pi.pedido_id = p.id
        WHERE p.status IN ('pago', 'enviado', 'entregue')
        GROUP BY pi.sku
        ORDER BY total_vendido DESC
    `).all();
}

/**
 * Vendas por mês
 */
function queryVendasPorMes() {
    return db.prepare(`
        SELECT 
            strftime('%Y-%m', criado_em) as mes,
            COUNT(*) as total_pedidos,
            SUM(total) as total_vendas
        FROM pedidos
        WHERE status IN ('pago', 'enviado', 'entregue')
        GROUP BY mes
        ORDER BY mes DESC
    `).all();
}

// ============================================================
// EXECUTAR EXEMPLOS (descomente para testar)
// ============================================================

// exemploCriarUsuario();
// exemploBuscarUsuarioPorEmail('maria@email.com');
// exemploCriarEndereco(1);
// exemploInserirProduto();
// exemploListarProdutos();
// exemploEstatisticas();
// exemploFluxoCompleto();

module.exports = {
    exemploCriarUsuario,
    exemploBuscarUsuarioPorEmail,
    exemploBuscarUsuarioPorCPF,
    exemploCriarEndereco,
    exemploListarEnderecos,
    exemploInserirProduto,
    exemploBuscarProduto,
    exemploAtualizarEstoque,
    exemploListarProdutos,
    exemploCriarPedidoCompleto,
    exemploBuscarPedidoCompleto,
    exemploAtualizarStatusPedido,
    exemploRegistrarAuditoria,
    exemploConsultarAuditoria,
    exemploEstatisticas,
    exemploFluxoCompleto,
    queryPedidosDoDia,
    queryTopClientes,
    queryProdutosMaisVendidos,
    queryVendasPorMes
};
