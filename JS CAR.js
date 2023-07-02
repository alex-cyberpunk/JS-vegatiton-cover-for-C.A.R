//Importa o Arquivo .shp com a geometria apenas do município de SP para não sobrecarregar a memória
var SP = table;
Map.centerObject(SP);
Map.addLayer(SP, {},'Área de Interesse');

// Centraliza o mapa em São Paulo.
Map.centerObject(SP, 12);

// Ajusta a escala (resolução) que será utilizada para o processamento.
var escala = 5;

//Seleção das bandas a serem trabalhadas
var bandas =ee.List(['B2','B3','B4','B8','B11','MSK_CLDPRB','SCL']);

//Seleção para classificação
var bandasClassificacao =ee.List(['B2','B3','B4','B8','NDVI','EVI','NDBI']);

//2019
//Seleção da imagem a ser trabalhada
var colecaoSentinel2Selecao = colecaoSentinel2.filterBounds(SP)
                                    .filterMetadata('CLOUDY_PIXEL_PERCENTAGE', 'less_than', 20)
                                    .filterDate('2020-01-01','2021-01-01')
                                    .select(bandas);
                                    

// Função para recortar parte da imagem na região desejada.
var clipColecao = function (imagem){
  return(imagem.clip(SP));
};

// Faz o clip da região desejada em toda coleção.
colecaoSentinel2Selecao = colecaoSentinel2Selecao.map(clipColecao);


// Faz a remoção de regiões que possivelmente possuem nuvens.
var removeNuvensColecao = function (imagem){
  var imagemSemNuvens = imagem.updateMask(imagem.select('MSK_CLDPRB').lt(50))
                              .updateMask(imagem.select('SCL').neq(3))
                              .updateMask(imagem.select('SCL').neq(7))
                              .updateMask(imagem.select('SCL').neq(8))
                              .updateMask(imagem.select('SCL').neq(9))
                              .updateMask(imagem.select('SCL').neq(10));
  return imagemSemNuvens;
};

// Executa a função de remoção das nuvens na coleção.
var colecaoSentinel2SelecaoSemNuvens = colecaoSentinel2Selecao.map(removeNuvensColecao);

// Função para remoção de valores inválidos.
var removeValoresInvalidos = function (imagem){
  var imagemSemValoresInvalidos = imagem.updateMask(imagem.select('B2').lt(10000))
                                        .updateMask(imagem.select('B3').lt(10000))
                                        .updateMask(imagem.select('B4').lt(10000))
                                        .updateMask(imagem.select('B8').lt(10000));
  return imagemSemValoresInvalidos;
};

// Executa a função de remoção dos valores inválidos na coleção.
var colecaoSentinel2SelecaoSemNuvens = colecaoSentinel2SelecaoSemNuvens.map(removeValoresInvalidos);

// Criação de mosaico a partir da coleção.
var imagem = colecaoSentinel2SelecaoSemNuvens.mosaic();
// Criação de composição a partir da coleção.
var imagem = colecaoSentinel2SelecaoSemNuvens.mean();

// Ajuste nos valores de reflectância das imagens.
imagem = imagem.multiply(0.0001);

// Extraindo as bandas do vermelho e do infravermelho próximo
var imagemBandaNir = imagem.select('B8');
var imagemBandaVermelho = imagem.select('B4');

// Código para cálculo do NDVI no GEE
imagem = imagem.addBands(
imagemBandaNir.subtract(imagemBandaVermelho)
.divide(imagemBandaNir.add(imagemBandaVermelho))
.rename('NDVI'),['NDVI']);

//Adicionando imagem NDVI
Map.addLayer(imagem, {bands: ['NDVI'], min: -1, max: 1}, 'NDVI 2019');

// Código para cálculo do EVI2 no GEE
imagem = imagem.addBands(
imagemBandaNir.subtract(imagemBandaVermelho)
.multiply(2.5).divide(imagemBandaVermelho.multiply(2.4).add(imagemBandaNir).add(1))
.rename('EVI'),['EVI']);

//Adicionando imagem EVI
Map.addLayer(imagem, {bands: ['EVI'], min: -1, max: 1}, 'EVI 2019');

// Código para cálculo do NDBI no GEE
var imagemBandaSwir = imagem.select('B11');
imagem = imagem.addBands(
imagemBandaNir.subtract(imagemBandaSwir)
.divide(imagemBandaNir.add(imagemBandaSwir)).subtract(imagemBandaNir.subtract(imagemBandaVermelho)
.divide(imagemBandaNir.add(imagemBandaVermelho)))
.rename('NDBI'),['NDBI']);

//Adicionando imagem NDVI
Map.addLayer(imagem, {bands: ['NDBI'], min: -1, max: 1}, 'NDBI 2019');

// Ajuste nos valores de reflectância das imagens.
imagem = imagem.multiply(0.0001);

// Descarta as bandas usadas para se eliminar efeitos de nuvens.
imagem = imagem.select(bandasClassificacao);

// Agrega todas as amostras coletadas pelo usuário em uma FeatureCollection.
var amostraCompletaGeometrias = amostraAreaConsolidada.merge(amostraVegetacaoNativa);
                                           
// Extrai o valor de todos os pixels nas regiões amostradas.
var amostraTreinamento = imagem.sampleRegions({
  collection: amostraCompletaGeometrias,
  properties: ['classe'],
  scale: escala
});

// Tamanho da amostra a ser coletada para cada classe.
var tamanhoAmostraClasse = 500;

// Segunda opção de amostragem, pegando um número limitado de pixels por classe.
// Tamanho da amostra a ser coletada para cada classe.
var tamanhoAmostraClasse = 500;
// Função para fazer uma amostra dentro das regiões de uma feature collection.
var coletaPixelsAmostra = function (regiaoAmostra) {
  var semente = ee.Number(Math.random()).multiply(10000).toLong();
  var amostra = imagem.sample({
                                region:ee.FeatureCollection(regiaoAmostra),
                                dropNulls: true,
                                seed: semente,
                                scale:escala,
                                numPixels: tamanhoAmostraClasse,
                                geometries: false
                            });
  var numeroClasse = ee.FeatureCollection(regiaoAmostra).first().get('classe');
  return amostra.map(function (feature) {
                                          return feature.set(
                                                              {'classe': numeroClasse}
                                                            );
                                        }
                    );
};

// Cria uma lista com as feature collections das regiões amostradas para cada classe.
var listaAmostraClasses = ee.List(
                          [
                            amostraVegetacaoNativa,
                            amostraAreaConsolidada
                          ]
                        );

// Executa a função para colher amostras nas feature collections de cada classe a partir
// da lista com as amostras. O resultado é uma lista com uma feature collection para 
// cada cada classe com a respectiva amostra.
var listaAmostraPixels = listaAmostraClasses.map(coletaPixelsAmostra);

// Agrega todas as amostras coletadas pelo usuário em uma FeatureCollection.
var amostraCompletaPixels= ee.FeatureCollection(listaAmostraPixels).flatten();

// Adiciona uma propriedade a cada pixel da amostra com um número real entre 0 e 1 aleatório.
var semente = ee.Number(Math.random()).multiply(10000).toLong();
var amostraCompletaPixels = amostraCompletaPixels.randomColumn('random', semente);

// Separa cerca de 70% dos dados para treinamento, utilizando a propriedade com número aleatório gerada.
// De forma similar, seleciona 15% para validação e 15% para teste final.
var amostraTreinamento = amostraCompletaPixels.filter(ee.Filter.lt('random', 0.7));
var amostraValidacao = amostraCompletaPixels.filter(ee.Filter.gte('random', 0.7))
                                            .filter(ee.Filter.lt('random', 0.85));
var amostraTeste = amostraCompletaPixels.filter(ee.Filter.gte('random', 0.85));

//smile.RandomForest
// Instancia um classificador na memória com os parâmetros dados e treinando no conjunto de treinamento.
var classificadorTreinado = ee.Classifier.smileRandomForest(100)
                                         .train(amostraTreinamento, 'classe', bandasClassificacao);

// Matriz de confusão do conjunto de treinamento e acurácia.
var matrizConfusaoAmostraTreinamento = classificadorTreinado.confusionMatrix();
print('Matriz de confusão RF 2019: ', matrizConfusaoAmostraTreinamento);
print('Acurácia no conjunto de treinamento RF 2019: ', matrizConfusaoAmostraTreinamento.accuracy());

// Aplica o classificador treinado no conjunto de treinamento no conjunto de validação.
var amostraValidacaoClassificada = amostraValidacao.classify(classificadorTreinado);

// Matriz de erros do classificador aplicado ao conjunto de validação e acurácia da classificação no mesmo.
var matrizErroAmostraValidacao = amostraValidacaoClassificada.errorMatrix('classe', 'classification');
print('Matriz de erros no conjunto de validação RF 2019: ', matrizErroAmostraValidacao);
print('Acurácia no conjunto de validação RF 2019: ', matrizErroAmostraValidacao.accuracy());

// Aplica o classificador treinado no conjunto de treinamento no conjunto de teste.
var amostraTesteClassificada = amostraTeste.classify(classificadorTreinado);

// Calcula a matriz de erros da amostra de testes.
var matrizErroAmostraTeste = amostraTesteClassificada.errorMatrix('classe', 'classification');
print('Matriz de erro no conjunto de teste RF 2019: ', matrizErroAmostraTeste);
print('Acurácia no conjunto de teste RF 2019: ', matrizErroAmostraTeste.accuracy());

// Classifica a imagem com o classificador treinado e com os parâmetros definidos.
var imagemClassificada = imagem.classify(classificadorTreinado);

// Paleta de cores para adicionar a imagem classificada ao mapa.
var paletaCoresClasses = "006901," + // Vegetação Nativa.
                         "888382"    // Área Consolidada.
                         
// Adiciona o layer com o resultado da classificação.
Map.addLayer(imagemClassificada.clip(SP), {
      "min": 0,
      "max": 2,
      "palette": paletaCoresClasses,
    "format": "png"
},  'Imagem Classificada - RandomForest 2019',true);

var vectors = imagemClassificada.reduceToVectors({
  geometry: table,
  crs: imagemClassificada.projection(),
  scale: 5,
  maxPixels: 100000000,
  geometryType: 'polygon',
  eightConnected: false,
  labelProperty: 'classe',
});

Export.table.toDrive({
  collection: vectors,
  description: 'classificacao',
  fileFormat: 'SHP',
  });

//LEGENDA
// Cria um painel para adicionar a legenda.
var PainelLegenda = ui.Panel({
  style: {
    // position define a posiãção do painel no mapa.
    // padding define o afastamento dos elementos internos do painel das margens do mesmo.
    position: 'bottom-left',
    padding: '8px 15px'
  }
});

// Cria um título para a legenda da classificação.
var TituloLegenda = ui.Label({
  value: 'FazCar by DaniCar',
  style: {
    fontWeight: 'bold',
    fontSize: '18px',
    margin: '0 0 4px 0',
    padding: '0'
  }
});
// Adiciona o título da legenda.
PainelLegenda.add(TituloLegenda);

// Função para criar as linhas da legenda que apresentam as classes e suas respectivas cores.
var criaLinha = function(cor, nomeClasse) {
  // Cria o box com a cor da classe.
  var boxCor = ui.Label({
    // Configura a apresentação do box com cor.
    style: {
      backgroundColor: '#' + cor,
      // padding define o afastamento interno do texto das margens do label (nesse caso não há texto).
      // margin define o afastamento entre os labels (cria espaços fora do label).
      padding: '8px',
      margin: '0 0 4px 0'
    }
  });

  // Cria label com o nome da classe.
  var descricao = ui.Label({
    value: nomeClasse,
    // Configura a apresentação da posição do texto no label.
    // margin define o afastamento entre os labels (cria espaços fora do label).
    style: {margin: '0 0 4px 6px'}
  });
  // Retorna um painel com box e label adicionados lado a lado (na horizontal).
  return ui.Panel({
    widgets: [boxCor, descricao],
    layout: ui.Panel.Layout.Flow('horizontal')
  });
};

// Adiciona uma linha para cada classe na legenda, com sua respectiva cor e identificação.
//OBS: mudamos alguns nomes em relação ao original 
PainelLegenda.add(criaLinha('006901', 'Vegetação Nativa'));
PainelLegenda.add(criaLinha('888382', 'Área Consolidada'));

// Adiciona a legenda ao mapa.
Map.add(PainelLegenda);