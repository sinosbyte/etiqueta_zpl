import type { Lang } from './index';

// The text of the "How it works" tab and of the first-access tutorial, in one place so it is easy to review.
// It is written for the person who draws labels, not for a programmer: no code, no printer language, no technical terms.
// (tests/help.test.ts keeps both languages with the same structure and keeps technical words out.)

export type TutorialIcon = 'template' | 'elements' | 'variable' | 'preview' | 'save';

export interface HelpSection {
  id: string;
  title: string;
  body: string[];
  /** A short list of "term: explanation" lines */
  list?: { term: string; text: string }[];
}

export interface HelpContent {
  intro: string;
  sections: HelpSection[];
  faq: { q: string; a: string }[];
  tutorial: { title: string; text: string; icon: TutorialIcon }[];
}

const ptBR: HelpContent = {
  intro: 'O Zebra Label Designer é o editor onde você desenha etiquetas para impressoras Zebra, sem precisar programar. Você coloca os elementos onde quiser, vê como a etiqueta vai ficar e salva. Depois de salvo, o design fica disponível para o SAP imprimir.',
  sections: [
    {
      id: 'start',
      title: 'Por onde começar',
      body: ['Há três caminhos. Escolha o que for mais rápido para o seu caso:'],
      list: [
        { term: 'Usar um modelo pronto', text: 'Abra Templates, escolha um modelo e clique em "Usar este template". Ele abre no editor como um design novo, e o modelo original não muda.' },
        { term: 'Começar do zero', text: 'Defina a largura e a altura da etiqueta no alto da tela e adicione os elementos pelo menu da esquerda.' },
        { term: 'Continuar um trabalho', text: 'Abra Meus designs para ver o que você já salvou e continuar de onde parou.' },
      ],
    },
    {
      id: 'build',
      title: 'Montar a etiqueta',
      body: [
        'Clique em um elemento no menu da esquerda para colocá-lo na etiqueta. Depois arraste para mudar de lugar e use as alças nos cantos para mudar o tamanho. Ao selecionar um elemento, o painel da direita mostra as opções dele.',
      ],
      list: [
        { term: 'Texto', text: 'Qualquer texto da etiqueta, fixo ou que muda a cada impressão.' },
        { term: 'Código de barras 128 e Intercalado 2 de 5', text: 'Códigos de barras para leitores. O 128 aceita letras e números; o Intercalado 2 de 5 aceita só números.' },
        { term: 'QR Code e Data Matrix', text: 'Códigos quadrados que guardam mais informação em pouco espaço. Você vê no painel o tamanho que eles terão impressos.' },
        { term: 'Caixa e Linha', text: 'Para desenhar molduras e divisões.' },
        { term: 'Imagem / logo', text: 'Para colocar o logo da empresa ou outra figura.' },
        { term: 'Tabela', text: 'Para listas, como vários materiais em uma mesma etiqueta (veja "Tabela e quebra de página").' },
      ],
    },
    {
      id: 'tips',
      title: 'Dicas para trabalhar mais rápido',
      body: [],
      list: [
        { term: 'Desfazer e refazer', text: 'Ctrl+Z desfaz e Ctrl+Shift+Z refaz.' },
        { term: 'Vários elementos', text: 'Segure Ctrl ou Shift ao clicar para selecionar vários e depois alinhar ou distribuir pelos botões do alto.' },
        { term: 'Encaixe automático', text: 'Os elementos "grudam" nos vizinhos e nas bordas para ficarem alinhados. Segure Alt ao arrastar para posicionar livremente.' },
        { term: 'Camadas', text: 'A lista de camadas, no menu da esquerda, ajuda a achar um elemento escondido atrás de outro.' },
        { term: 'Aviso de borda', text: 'Uma caixa tracejada âmbar indica que o elemento passa da borda da etiqueta. O editor só avisa, nada é movido sozinho.' },
      ],
    },
    {
      id: 'units',
      title: 'Medidas: milímetros e pontos',
      body: [
        'A impressora desenha a etiqueta em pontinhos, chamados pontos. Em uma impressora Zebra comum, 1 milímetro equivale a 8 pontos. Assim, uma etiqueta de 100 mm tem 800 pontos de largura.',
        'No dia a dia use milímetros: é a medida que você vê na régua e na etiqueta de papel. O botão "mm | pontos" no alto da tela troca a unidade dos campos, se você precisar da medida exata em pontos. Você pode digitar com vírgula ou com ponto (por exemplo, 12,5), e as setas dos campos mudam de meio em meio milímetro.',
      ],
    },
    {
      id: 'variables',
      title: 'Campos que mudam em cada etiqueta',
      body: [
        'Algumas informações mudam de uma etiqueta para outra, como o código do produto ou a quantidade. Para isso, escreva o nome do campo entre chaves duplas, por exemplo {{PRODUTO}} ou {{QUANTIDADE}}. Na hora de imprimir, o SAP troca cada campo pelo valor verdadeiro.',
        'Use só letras sem acento, números e o traço baixo (_) nos nomes. Com nada selecionado, o painel da direita lista todos os campos do seu design e onde cada um é usado. Os campos também funcionam dentro de códigos de barras e QR Codes.',
      ],
    },
    {
      id: 'testdata',
      title: 'Dados de teste e pré-visualização',
      body: [
        'Para ver a etiqueta como ela vai sair, abra Dados de teste (a barra abaixo da etiqueta). Ali você escreve um valor de teste para cada campo e clica em Pré-visualizar. Depois de mudar qualquer coisa, clique em Atualizar para ver de novo.',
        'A pré-visualização é uma imagem gerada por um serviço na internet, então precisa de conexão. Se ela estiver indisponível, você continua editando e salvando normalmente.',
      ],
      list: [
        { term: 'Muda por etiqueta', text: 'Liga um campo que tem um valor diferente em cada etiqueta (por exemplo, o número do volume).' },
        { term: 'Variantes de teste', text: 'Guardam conjuntos de valores com um nome, para você testar vários cenários do mesmo design sem digitar tudo de novo.' },
      ],
    },
    {
      id: 'table',
      title: 'Tabela e quebra de página',
      body: [
        'Use a tabela quando uma mesma etiqueta precisa listar vários itens, como materiais. Cada coluna recebe um campo (por exemplo, Material, Descrição e Quantidade) e você define a largura de cada uma. Os itens vêm dos Dados de teste e, na impressão, do SAP.',
        'O botão "+ Quebra de página" adiciona uma segunda etiqueta embaixo da primeira. A Página 1 é impressa uma vez e a Página 2 se repete: quando há mais itens do que cabem, o editor continua os itens restantes em novas etiquetas, na quantidade que for preciso. Cada página aceita uma tabela e o modelo tem no máximo duas páginas.',
      ],
    },
    {
      id: 'save',
      title: 'Salvar, exportar e imprimir',
      body: [
        'Clique em Salvar para guardar o design. O nome não pode se repetir entre os seus designs. Você pode salvar como uma nova versão ou substituir a versão atual. Enquanto houver mudanças sem salvar, aparece o selo "Não salvo" no alto da tela, e o editor pergunta antes de você sair ou abrir outro design.',
        'Ao salvar, o editor também avisa se alguma parte do design pode dar problema no SAP. O aviso não impede de salvar.',
        'O botão Exportar gera uma imagem ou um PDF da etiqueta, para visualizar e compartilhar. Para imprimir de verdade, o design salvo é levado para o SAP, onde quem imprime escolhe o design pelo nome, preenche os campos e envia para a impressora.',
      ],
    },
    {
      id: 'code',
      title: 'A aba Código e o lado a lado',
      body: [
        'Você não precisa usar essas abas para criar etiquetas. Elas existem para quem conhece a linguagem das impressoras Zebra e quer ver ou ajustar o texto que a impressora recebe. A aba Lado a lado mostra o desenho e esse texto juntos, sempre sincronizados. Em designs com duas páginas ou com tabela, o código é só para leitura.',
      ],
    },
  ],
  faq: [
    { q: 'Fechei a página sem querer. Perdi meu trabalho?', a: 'Só o que não foi salvo. Quando há mudanças sem salvar, o navegador pergunta antes de fechar a página. Salve com frequência.' },
    { q: 'Posso usar um modelo pronto e mudar tudo?', a: 'Pode. O modelo abre como um design novo, que é seu, e o original continua igual para todo mundo.' },
    { q: 'A pré-visualização não aparece. O que faço?', a: 'Ela depende da internet e de um serviço externo, que às vezes fica indisponível ou atinge o limite do dia. Edição, salvamento e exportação continuam funcionando; tente pré-visualizar de novo mais tarde.' },
    { q: 'Quantas páginas uma etiqueta pode ter?', a: 'Duas no modelo. A segunda se repete quantas vezes forem necessárias para listar todos os itens da tabela.' },
    { q: 'O elemento está com uma caixa tracejada. É erro?', a: 'É um aviso. Tracejado âmbar quer dizer que o elemento passa da borda da etiqueta. Tracejado vermelho em um código de barras quer dizer que ele pode ficar por cima de outro elemento. Você decide se ajusta.' },
    { q: 'Como meu design chega ao SAP?', a: 'Depois de salvar, o design pode ser capturado pelo SAP. Quem cuida do SAP faz essa captura, e depois a etiqueta já pode ser escolhida pelo nome na impressão.' },
    { q: 'Posso usar acentos nos textos?', a: 'Pode. Acentos e caracteres como ç funcionam normalmente.' },
  ],
  tutorial: [
    { icon: 'template', title: 'Comece por um modelo ou do zero', text: 'Em Templates você encontra modelos prontos para usar. Se preferir, comece com a etiqueta em branco e defina a largura e a altura no alto da tela.' },
    { icon: 'elements', title: 'Adicione os elementos', text: 'No menu da esquerda, clique em Texto, Código de barras, QR Code, Caixa, Linha ou Imagem. Arraste para o lugar certo e use as alças para mudar o tamanho.' },
    { icon: 'variable', title: 'Crie campos que mudam', text: 'Para uma informação diferente a cada etiqueta, escreva o nome entre chaves duplas, como {{PRODUTO}}. No momento de imprimir, o SAP preenche o valor.' },
    { icon: 'preview', title: 'Veja como vai ficar', text: 'Abra Dados de teste, escreva um valor de exemplo para cada campo e clique em Pré-visualizar. Mudou algo? Clique em Atualizar.' },
    { icon: 'save', title: 'Salve o seu design', text: 'Clique em Salvar e dê um nome. Ele aparece em Meus designs e fica pronto para o SAP imprimir. Você pode rever este tutorial a qualquer momento em Como funciona.' },
  ],
};

const en: HelpContent = {
  intro: 'The Zebra Label Designer is the editor where you design labels for Zebra printers, with no programming. You place the elements where you want them, see how the label will look and save it. Once saved, the design is available for SAP to print.',
  sections: [
    {
      id: 'start',
      title: 'Where to start',
      body: ['There are three ways in. Pick whichever is quickest for you:'],
      list: [
        { term: 'Use a ready-made template', text: 'Open Templates, choose one and click "Use this template". It opens in the editor as a new design, and the original template does not change.' },
        { term: 'Start from scratch', text: 'Set the width and height of the label at the top of the screen and add elements from the menu on the left.' },
        { term: 'Continue your work', text: 'Open My Designs to see what you already saved and pick up where you left off.' },
      ],
    },
    {
      id: 'build',
      title: 'Building the label',
      body: [
        'Click an element in the menu on the left to place it on the label. Then drag it to move it and use the handles on the corners to resize it. When an element is selected, the panel on the right shows its options.',
      ],
      list: [
        { term: 'Text', text: 'Any text on the label, fixed or changing with each print.' },
        { term: 'Barcode 128 and Interleaved 2 of 5', text: 'Barcodes for scanners. The 128 accepts letters and numbers; Interleaved 2 of 5 accepts numbers only.' },
        { term: 'QR Code and Data Matrix', text: 'Square codes that hold more information in little space. The panel shows the size they will have when printed.' },
        { term: 'Box and Line', text: 'To draw frames and dividers.' },
        { term: 'Image / logo', text: 'To place the company logo or another picture.' },
        { term: 'Table', text: 'For lists, such as several materials on the same label (see "Table and page break").' },
      ],
    },
    {
      id: 'tips',
      title: 'Tips to work faster',
      body: [],
      list: [
        { term: 'Undo and redo', text: 'Ctrl+Z undoes and Ctrl+Shift+Z redoes.' },
        { term: 'Several elements', text: 'Hold Ctrl or Shift while clicking to select several, then align or distribute them with the buttons at the top.' },
        { term: 'Automatic snapping', text: 'Elements "stick" to their neighbours and to the edges so they stay aligned. Hold Alt while dragging to place freely.' },
        { term: 'Layers', text: 'The layers list in the left menu helps you find an element hidden behind another.' },
        { term: 'Edge warning', text: 'An amber dashed box means the element goes past the edge of the label. The editor only warns, nothing is moved for you.' },
      ],
    },
    {
      id: 'units',
      title: 'Measurements: millimetres and dots',
      body: [
        'The printer draws the label in tiny dots. On a standard Zebra printer, 1 millimetre equals 8 dots, so a 100 mm label is 800 dots wide.',
        'Use millimetres day to day: it is the measure you see on the ruler and on the paper label. The "mm | dots" button at the top of the screen switches the unit of the fields, in case you need the exact measure in dots. You can type with a comma or a full stop (for example, 12.5), and the arrows in the fields change the value by half a millimetre.',
      ],
    },
    {
      id: 'variables',
      title: 'Fields that change on every label',
      body: [
        'Some information changes from one label to the next, such as the product code or the quantity. For that, write the name of the field between double braces, for example {{PRODUCT}} or {{QUANTITY}}. When printing, SAP replaces each field with the real value.',
        'Use only letters without accents, numbers and the underscore (_) in the names. With nothing selected, the panel on the right lists all the fields of your design and where each one is used. Fields also work inside barcodes and QR Codes.',
      ],
    },
    {
      id: 'testdata',
      title: 'Test data and preview',
      body: [
        'To see the label as it will come out, open Test data (the bar below the label). There you write a test value for each field and click Preview. After changing anything, click Update to see it again.',
        'The preview is an image produced by an online service, so it needs a connection. If it is unavailable, you can still edit and save as usual.',
      ],
      list: [
        { term: 'Changes per label', text: 'Turns on a field that has a different value on each label (for example, the package number).' },
        { term: 'Test variants', text: 'Keep sets of values under a name, so you can try several scenarios of the same design without typing everything again.' },
      ],
    },
    {
      id: 'table',
      title: 'Table and page break',
      body: [
        'Use the table when one label has to list several items, such as materials. Each column gets a field (for example, Material, Description and Quantity) and you set the width of each one. The items come from Test data and, when printing, from SAP.',
        'The "+ Page break" button adds a second label below the first. Page 1 is printed once and Page 2 repeats: when there are more items than fit, the editor continues the remaining items on new labels, as many as needed. Each page takes one table and the template has at most two pages.',
      ],
    },
    {
      id: 'save',
      title: 'Saving, exporting and printing',
      body: [
        'Click Save to keep the design. The name cannot repeat among your designs. You can save as a new version or replace the current one. While there are unsaved changes, an "Unsaved" badge shows at the top of the screen, and the editor asks before you leave or open another design.',
        'When saving, the editor also warns if some part of the design may cause trouble in SAP. The warning does not stop you from saving.',
        'The Export button produces an image or a PDF of the label, to view and share. To actually print, the saved design is taken to SAP, where whoever prints picks the design by name, fills in the fields and sends it to the printer.',
      ],
    },
    {
      id: 'code',
      title: 'The Code tab and side by side',
      body: [
        'You do not need these tabs to create labels. They are for people who know the language of Zebra printers and want to see or adjust the text the printer receives. The Side by side tab shows the drawing and that text together, always in sync. In designs with two pages or a table, the code is read only.',
      ],
    },
  ],
  faq: [
    { q: 'I closed the page by accident. Did I lose my work?', a: 'Only what was not saved. When there are unsaved changes, the browser asks before closing the page. Save often.' },
    { q: 'Can I use a ready-made template and change everything?', a: 'Yes. The template opens as a new design, which is yours, and the original stays the same for everyone.' },
    { q: 'The preview does not show up. What do I do?', a: 'It depends on the internet and on an outside service, which is sometimes unavailable or reaches its daily limit. Editing, saving and exporting keep working; try the preview again later.' },
    { q: 'How many pages can a label have?', a: 'Two in the template. The second one repeats as many times as needed to list all the items of the table.' },
    { q: 'An element has a dashed box. Is that an error?', a: 'It is a warning. Amber dashes mean the element goes past the edge of the label. Red dashes on a barcode mean it may end up over another element. You decide whether to adjust it.' },
    { q: 'How does my design get to SAP?', a: 'After saving, the design can be captured by SAP. Whoever looks after SAP does the capture, and then the label can be picked by name when printing.' },
    { q: 'Can I use accents in the texts?', a: 'Yes. Accents and characters like ç work normally.' },
  ],
  tutorial: [
    { icon: 'template', title: 'Start from a template or from scratch', text: 'In Templates you will find ready-made models. If you prefer, start with a blank label and set the width and height at the top of the screen.' },
    { icon: 'elements', title: 'Add the elements', text: 'In the left menu, click Text, Barcode, QR Code, Box, Line or Image. Drag it to the right spot and use the handles to resize it.' },
    { icon: 'variable', title: 'Create fields that change', text: 'For information that differs on every label, write the name between double braces, like {{PRODUCT}}. When printing, SAP fills in the value.' },
    { icon: 'preview', title: 'See how it will look', text: 'Open Test data, write an example value for each field and click Preview. Changed something? Click Update.' },
    { icon: 'save', title: 'Save your design', text: 'Click Save and give it a name. It shows up in My Designs and is ready for SAP to print. You can review this tutorial at any time in How it works.' },
  ],
};

export const HELP: Record<Lang, HelpContent> = { 'pt-BR': ptBR, en };
