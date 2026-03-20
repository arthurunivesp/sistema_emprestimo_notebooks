💻 NotebookControl — Sistema de Empréstimo de Notebooks Escolar

O NotebookControl é um sistema web leve, profissional e intuitivo, desenvolvido especialmente para instituições de ensino gerenciarem o empréstimo de notebooks entre professores e setores. O sistema foi projetado para ser operado com um leitor de código de barras, permitindo o controle rápido de packs de equipamentos.




🚀 Principais Funcionalidades

📋 Gestão de Inventário e Status

•
Cadastro em Lote: Adicione múltiplos notebooks rapidamente lendo os números de série com um leitor de código de barras.

•
Status de Manutenção: Acompanhe o estado de cada equipamento (Disponível, Emprestado, Em Manutenção ou Reparo Profissional).

•
Configuração de Ativos: Painel para pré-cadastrar Marcas e Modelos, garantindo a padronização do estoque.

⏱️ Controle de Horários e Alertas (Time-Sensitive)

•
Agendamento de Retirada/Devolução: Defina horários limites para garantir a troca de turnos entre os professores.

•
Alerta de Proximidade (10 min): O sistema sinaliza automaticamente em amarelo quando faltarem menos de 10 minutos para a devolução.

•
Cronômetro de Atraso Crítico: Alerta pulsante em vermelho que exibe o tempo exato de atraso, facilitando a cobrança dos equipamentos.

⚠️ Empréstimos Emergenciais

•
Modo Emergencial: Opção dedicada para empréstimos fora da grade comum, exigindo autorização da coordenação e destacando o registro em vermelho intenso no histórico.

📊 Administração e Relatórios

•
Painel de Configurações: Gerencie listas de Professores, Marcas e Modelos.

•
Histórico Completo: Rastreabilidade total de quem pegou, quando pegou e quando devolveu.

•
Exportação CSV: Gere relatórios de estoque para Excel ou Google Sheets com um clique.




🛠️ Tecnologias Utilizadas

O sistema foi desenvolvido utilizando tecnologias web puras para garantir máxima performance e portabilidade, sem necessidade de servidores complexos ou bancos de dados externos:

•
HTML5: Estrutura semântica.

•
CSS3: Interface moderna com tema Dark Mode, animações de alerta e design responsivo.

•
JavaScript (ES6+): Lógica de monitoramento em tempo real, manipulação de dados e cronômetros.

•
LocalStorage API: Persistência de dados diretamente no navegador (os dados permanecem salvos mesmo após fechar a página).




📖 Como Usar

1.
Configuração Inicial: Vá na aba Configurações e cadastre as Marcas, Modelos e os nomes dos Professores.

2.
Cadastro: Na aba Cadastrar, selecione a Marca/Modelo e use o leitor de código de barras para adicionar os seriais.

3.
Empréstimo: Na aba Empréstimo, selecione o Professor, defina o horário limite e leia os códigos de barras dos notebooks do pack.

4.
Devolução: Na aba Devolução, basta ler o código de barras do notebook e confirmar. O sistema dará baixa automática no pack correspondente.




📦 Instalação

Como o sistema é baseado em tecnologias web padrão, não requer instalação:

1.
Baixe ou clone este repositório.

2.
Abra o arquivo index.html em qualquer navegador moderno (Chrome, Edge, Firefox).

3.
Dica: Para uso profissional, recomenda-se hospedar no GitHub Pages ou em um servidor local da escola.




📄 Licença

Este projeto foi desenvolvido para fins educacionais e de gestão institucional. Sinta-se à vontade para clonar e adaptar às necessidades da sua escola.




Desenvolvido com foco na agilidade e organização do ambiente escolar.

