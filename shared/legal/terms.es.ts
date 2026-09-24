/**
 * REQ-043 (amendment "it should be both") — the Spanish rendering of the three
 * legal documents. Mirrors shared/legal/terms.ts EXACTLY in structure (same
 * ids, section numbers, block kinds and list lengths — the unit test pins
 * that), so /terms can swap languages without touching layout.
 *
 * This is a translation made in-repo, not an attorney-reviewed Spanish
 * version; the `[INSERTAR …]` placeholders mirror the English `[INSERT …]`.
 */
import { type LegalBlock, type LegalDoc } from "./terms.ts";

export const LEGAL_EFFECTIVE_DATE_ES = "24 de septiembre de 2026";

const p = (text: string): LegalBlock => ({ kind: "p", text });
const list = (...items: string[]): LegalBlock => ({ kind: "list", items });
const labeled = (label: string, text: string): LegalBlock => ({
  kind: "labeled",
  label,
  text,
});

export const TERMS_OF_SERVICE_ES: LegalDoc = {
  id: "terms",
  title: "Términos de servicio",
  effectiveDate: LEGAL_EFFECTIVE_DATE_ES,
  notice:
    "ESTE ACUERDO ESTÁ SUJETO A ARBITRAJE CONFORME A LA LEY UNIFORME DE ARBITRAJE DE CAROLINA DEL SUR.",
  intro: [
    'Estos Términos de servicio ("Términos") constituyen un acuerdo legalmente vinculante entre usted y Paperwork Monster Inc., que opera como Paperwork Monster ("Paperwork Monster," "la Compañía," "nosotros," "nos" o "nuestro"), y rigen su acceso y uso de nuestros sitios web, aplicaciones, software, herramientas de comunicación, funciones habilitadas con inteligencia artificial y demás productos y servicios relacionados (en conjunto, los "Servicios").',
    "Al crear una cuenta, comprar una suscripción, marcar una casilla que indique su aceptación, o de cualquier otra forma acceder a los Servicios o usarlos, usted acepta quedar obligado por estos Términos, nuestra Política de reembolsos y cancelaciones y nuestra Política de privacidad. Si no está de acuerdo, no acceda a los Servicios ni los use.",
  ],
  sections: [
    {
      n: 1,
      heading: "Servicio de empresa a empresa",
      blocks: [
        p(
          "Paperwork Monster ofrece software y servicios relacionados destinados a ayudar a las empresas a administrar aspectos de sus operaciones, que pueden incluir clientes, prospectos, proyectos, estimados, cotizaciones, facturas, documentos, comunicaciones, flujos de trabajo, registros comerciales, reportes y otras funciones administrativas.",
        ),
        p(
          'Los Servicios están destinados a un uso empresarial y profesional, y no a un uso personal, familiar o doméstico. Usted declara que tiene al menos 18 años y que cuenta con autoridad para celebrar estos Términos a título personal o en nombre de la empresa u organización que representa. Si usa los Servicios en nombre de una entidad, "usted" y "Cliente" incluyen a esa entidad.',
        ),
      ],
    },
    {
      n: 2,
      heading: "Cuentas y usuarios autorizados",
      blocks: [
        p(
          "Debe proporcionar información exacta y actual al crear una cuenta y mantenerla razonablemente actualizada. Usted es responsable de mantener la confidencialidad de las credenciales de la cuenta, de la actividad que ocurra a través de su cuenta, de establecer los permisos apropiados para empleados y otros usuarios autorizados, de notificarnos con prontitud cualquier sospecha de acceso no autorizado y de asegurarse de que sus usuarios autorizados cumplan con estos Términos.",
        ),
        p(
          "No puede compartir credenciales de una manera diseñada para eludir los límites de la suscripción, los requisitos de asientos de usuario o los controles de acceso.",
        ),
      ],
    },
    {
      n: 3,
      heading: "Servicios y funciones",
      blocks: [
        p(
          "Las funciones disponibles para usted dependen de su plan de suscripción, de la configuración de su cuenta y de cualquier servicio adicional que compre. Paperwork Monster puede agregar, modificar, mejorar, descontinuar o reemplazar funciones de vez en cuando. Haremos esfuerzos comercialmente razonables para evitar reducir de forma sustancial la funcionalidad principal de una suscripción de pago durante un período de suscripción ya pagado por adelantado.",
        ),
        p(
          "Ciertas funciones pueden identificarse como beta, vista previa, experimentales o de acceso anticipado. Dichas funciones pueden cambiarse o descontinuarse en cualquier momento y pueden ser menos confiables que las funciones de disponibilidad general.",
        ),
      ],
    },
    {
      n: 4,
      heading: "Monster Free y pruebas gratuitas",
      blocks: [
        p(
          "Paperwork Monster puede ofrecer un nivel de suscripción gratuito conocido actualmente como Monster Free. Monster Free está pensado para seguir disponible sin cuota de suscripción, sujeto a las funciones, límites de uso, límites de almacenamiento, límites de comunicaciones y demás restricciones divulgadas para ese plan. Paperwork Monster puede cambiar las funciones o los límites de un plan gratuito de forma prospectiva.",
        ),
        p(
          "Paperwork Monster también puede ofrecer pruebas gratuitas de planes de suscripción de pago, incluidas pruebas de hasta 30 días u otro período divulgado al registrarse. Los términos presentados con una prueba en particular rigen esa prueba.",
        ),
        p(
          "Si una prueba requiere un método de pago y se divulga que se convierte automáticamente en una suscripción de pago, la suscripción de pago comenzará y el método de pago podrá cobrarse cuando termine la prueba, a menos que usted cancele antes de la fecha límite divulgada. La información de precios y renovación se divulgará antes de iniciar un cobro.",
        ),
      ],
    },
    {
      n: 5,
      heading: "Suscripciones y renovación automática",
      blocks: [
        p(
          "Las suscripciones de pago pueden ofrecerse con un ciclo de facturación mensual, anual u otro divulgado. Salvo que se indique lo contrario al momento de la compra, las suscripciones mensuales se renuevan automáticamente cada mes, las suscripciones anuales se renuevan automáticamente cada año y las cuotas de suscripción aplicables se cobran por adelantado para el período de suscripción siguiente.",
        ),
        p(
          "Al comprar una suscripción recurrente, usted autoriza a Paperwork Monster y a sus proveedores de procesamiento de pagos o servicios comerciales a cobrar a su método de pago seleccionado las cuotas de suscripción aplicables, los impuestos y los demás cargos que usted autorice. Su suscripción continúa hasta que se cancele conforme a estos Términos y a la Política de reembolsos y cancelaciones.",
        ),
      ],
    },
    {
      n: 6,
      heading: "Cuotas y pago",
      blocks: [
        p(
          "Usted acepta pagar todas las cuotas que se le divulguen al comprar o usar Servicios de pago. Los pagos pueden ser procesados por procesadores de pago o proveedores de servicios comerciales externos. Paperwork Monster puede recibir información relacionada con los pagos de esos proveedores, pero puede no recibir ni almacenar directamente las credenciales completas de la tarjeta de pago.",
        ),
        p(
          "Usted es responsable de mantener un método de pago válido. Si un pago no puede completarse, podemos reintentar el cobro, solicitar otro método de pago, restringir la funcionalidad de pago, suspender la cuenta o dar por terminados los Servicios de pago. Usted sigue siendo responsable de los montos debidamente incurridos antes de la suspensión o terminación.",
        ),
      ],
    },
    {
      n: 7,
      heading: "Cambios de precio",
      blocks: [
        p(
          "Paperwork Monster puede modificar los precios o las estructuras de precios de las suscripciones de vez en cuando. Salvo que se divulgue lo contrario o lo exija la ley, un cambio de precio que afecte a una suscripción de pago existente se aplicará de forma prospectiva en una renovación futura y no de forma retroactiva a un período de suscripción que ya se haya pagado. Daremos un aviso razonable de los cambios de precio sustanciales antes de que entren en vigor para una suscripción existente. Si no desea continuar con el nuevo precio, puede cancelar antes de la fecha de renovación aplicable.",
        ),
      ],
    },
    {
      n: 8,
      heading: "Cancelación y reembolsos",
      blocks: [
        p(
          "Puede cancelar una suscripción de pago en cualquier momento a través del proceso de administración de cuenta disponible o comunicándose con nosotros por un canal de soporte autorizado. Salvo que se indique expresamente lo contrario, la cancelación entra en vigor al final del período de suscripción pagado en curso, usted conserva el acceso a los Servicios de pago aplicables hasta el final de ese período y la cancelación evita la siguiente renovación automática.",
        ),
        p(
          "Los pagos de suscripción generalmente no son reembolsables, las porciones no utilizadas de los períodos de suscripción mensuales o anuales no se prorratean ni se reembolsan, y las cuotas de suscripción anuales generalmente no son reembolsables después de la compra, salvo que se indique expresamente lo contrario o lo exija la ley. Paperwork Monster puede emitir reembolsos, créditos o ajustes de facturación a su discreción por errores de facturación, cobros duplicados, problemas del servicio o circunstancias excepcionales. Encontrará más detalles en nuestra Política de reembolsos y cancelaciones, que se incorpora a estos Términos.",
        ),
      ],
    },
    {
      n: 9,
      heading: "Datos del Cliente",
      blocks: [
        p(
          'Entre usted y Paperwork Monster, usted conserva la propiedad de la información, los registros, los documentos, las imágenes, la información de clientes, los estimados, las facturas, la información de proyectos y demás contenido que usted o sus usuarios autorizados envíen a los Servicios ("Datos del Cliente").',
        ),
        p(
          "Usted otorga a Paperwork Monster una licencia no exclusiva y mundial para alojar, almacenar, reproducir, procesar, transmitir, mostrar, analizar y de otro modo usar los Datos del Cliente según sea razonablemente necesario para prestar y proteger los Servicios, realizar las acciones que usted solicite, dar soporte a su cuenta, mantener y mejorar los Servicios, detectar fraude, abuso o amenazas de seguridad, cumplir con la ley y cumplir los fines descritos en nuestra Política de privacidad.",
        ),
        p(
          "Usted declara que cuenta con los derechos y permisos necesarios para proporcionarnos los Datos del Cliente y para indicarnos que los procesemos.",
        ),
      ],
    },
    {
      n: 10,
      heading: "Información sobre sus clientes, empleados y otros contactos",
      blocks: [
        p(
          "Los Servicios pueden permitirle almacenar o procesar información sobre sus clientes, prospectos, empleados, subcontratistas, proveedores y otros terceros. Usted es responsable de determinar si cuenta con una base legal y con todos los avisos, permisos, autorizaciones o consentimientos necesarios para recopilar, cargar, almacenar, usar y comunicarse usando esa información. Paperwork Monster actúa como proveedor de tecnología y no establece de forma independiente la relación comercial entre usted y sus clientes.",
        ),
      ],
    },
    {
      n: 11,
      heading:
        "Mensajes de texto, llamadas, correos electrónicos y comunicaciones con clientes",
      blocks: [
        p(
          "Los Servicios pueden permitirle comunicarse con clientes, prospectos, empleados, proveedores u otras personas mediante mensajes de texto SMS o MMS, teléfono, correo electrónico u otros canales de comunicación.",
        ),
        p(
          "Cuando usted inicia, programa, autoriza o configura una comunicación a través de los Servicios, usted es responsable de esa comunicación y de la base legal que la permite, salvo cuando Paperwork Monster se comunique por separado en su propio nombre.",
        ),
        p(
          "Antes de enviar comunicaciones a través de los Servicios, debe obtener y mantener todos los consentimientos y autorizaciones legalmente requeridos de cada destinatario. Cuando corresponda, esto incluye el consentimiento expreso previo para mensajes informativos y el consentimiento expreso previo por escrito para mensajes de marketing o promocionales. El consentimiento debe ser lo suficientemente específico para identificar al remitente y el tema de las comunicaciones, y no debe transferirse desde otra empresa a menos que la ley aplicable y las reglas del proveedor de mensajería lo permitan expresamente.",
        ),
        p(
          "Usted acepta mantener evidencia apropiada del consentimiento, incluidos la fecha, el método, la fuente, el alcance y el destinatario del consentimiento cuando sea razonablemente requerido. Debe atender con prontitud las solicitudes de exclusión, cancelación de suscripción, STOP, revocación y similares, y no debe reanudar las comunicaciones a menos que el destinatario vuelva a otorgar un consentimiento válido.",
        ),
        p(
          "No puede usar los Servicios para enviar comunicaciones no solicitadas, engañosas, ilegales, abusivas o prohibidas. Paperwork Monster puede bloquear, filtrar, suspender, limitar o dar por terminada la funcionalidad de mensajería o llamadas cuando sea razonablemente necesario para cumplir con la ley aplicable, las reglas de las operadoras, los requisitos de los proveedores, las políticas de las plataformas o los requisitos de prevención de abuso.",
        ),
      ],
    },
    {
      n: 12,
      heading: "Contratos con clientes, cotizaciones, estimados y facturas",
      blocks: [
        p(
          "Los Servicios pueden permitirle crear o entregar cotizaciones, estimados, propuestas, facturas, contratos, acuses de recibo o documentos relacionados. Paperwork Monster no es parte de los acuerdos entre usted y sus clientes por el simple hecho de que esos acuerdos o documentos se creen, entreguen, aprueben, firmen o almacenen usando los Servicios.",
        ),
        p(
          "Usted es responsable de determinar los términos apropiados para su trabajo, incluidos precios, alcance, depósitos, requisitos de pago, garantías, derechos de cancelación, divulgaciones de licencias, avisos al consumidor, requisitos de contratos de construcción y demás términos aplicables a su negocio. Las plantillas, cláusulas de ejemplo, sugerencias automatizadas u otra información disponible a través de los Servicios se ofrecen por conveniencia y no constituyen asesoría legal.",
        ),
      ],
    },
    {
      n: 13,
      heading: "Inteligencia artificial y funciones automatizadas",
      blocks: [
        p(
          "Algunos Servicios pueden usar inteligencia artificial, aprendizaje automático, procesamiento automatizado o tecnologías similares. Las funciones habilitadas con IA pueden ayudar con redacción, resúmenes, recomendaciones, organización de datos, estimados, descripciones, cálculos, comunicaciones u otras funciones comerciales.",
        ),
        p(
          "Los resultados generados por IA o automatizados pueden ser incompletos, inexactos, inapropiados o no adecuados para sus circunstancias. Usted es responsable de revisar los resultados antes de confiar en ellos, enviarlos, publicarlos o usarlos. Paperwork Monster no declara que la información generada por IA constituya asesoría legal, contable, fiscal, de ingeniería, financiera, laboral, de seguros, de construcción, de licencias ni de otro tipo profesional. Usted sigue siendo responsable de las decisiones que tome usando los Servicios.",
        ),
      ],
    },
    {
      n: 14,
      heading: "Documentos comerciales sensibles",
      blocks: [
        p(
          "Si está habilitado, los Servicios pueden permitir a los clientes cargar documentos comerciales como certificados de seguro, formularios fiscales, formularios W-9, información de identificación fiscal, licencias, permisos o registros comerciales similares. Debe cargar dicha información solo cuando sea razonablemente necesario para fines comerciales legítimos y solo si tiene autoridad para hacerlo. Paperwork Monster puede aplicar restricciones o requisitos de seguridad adicionales a las funciones de documentos sensibles.",
        ),
      ],
    },
    {
      n: 15,
      heading: "Uso aceptable",
      blocks: [
        p("No puede usar los Servicios para:"),
        list(
          "violar leyes o regulaciones aplicables;",
          "infringir derechos de propiedad intelectual, privacidad, publicidad u otros derechos;",
          "enviar spam, comunicaciones ilegales o comunicaciones para las que no se haya obtenido el consentimiento requerido;",
          "participar en fraude, suplantación de identidad o actividades engañosas;",
          "distribuir malware o código malicioso;",
          "interferir con la seguridad o el funcionamiento de los Servicios;",
          "intentar el acceso no autorizado a sistemas o cuentas;",
          "extraer o recopilar información salvo mediante la funcionalidad que proporcionamos expresamente;",
          "realizar ingeniería inversa o intentar derivar el código fuente, salvo cuando dicha restricción esté prohibida por la ley;",
          "eludir controles de suscripción, uso, seguridad o acceso;",
          "usar los Servicios para facilitar discriminación ilegal, acoso, amenazas o abuso; o",
          "usar los Servicios de una manera que cree un riesgo irrazonable para Paperwork Monster, sus proveedores de servicios, clientes o terceros.",
        ),
      ],
    },
    {
      n: 16,
      heading: "Nuestra propiedad intelectual",
      blocks: [
        p(
          "Paperwork Monster y sus licenciantes conservan todos los derechos sobre los Servicios, incluidos el software, las interfaces, los diseños, los flujos de trabajo, las marcas comerciales, los logotipos, la documentación, las bases de datos, la tecnología y demás materiales propietarios, excluidos los Datos del Cliente. Sujeto a estos Términos y al pago de las cuotas aplicables, Paperwork Monster le otorga un derecho limitado, no exclusivo, intransferible y revocable para acceder a los Servicios y usarlos para sus fines comerciales internos durante el período de suscripción aplicable. No se le transfiere ningún derecho de propiedad.",
        ),
      ],
    },
    {
      n: 17,
      heading: "Comentarios",
      blocks: [
        p(
          "Si nos proporciona sugerencias, ideas, solicitudes de funciones o comentarios sobre los Servicios, usted permite a Paperwork Monster usar esos comentarios sin restricción ni compensación para usted, siempre que esto no transfiera la propiedad de sus Datos del Cliente.",
        ),
      ],
    },
    {
      n: 18,
      heading: "Servicios de terceros",
      blocks: [
        p(
          "Los Servicios pueden integrarse con servicios de terceros o depender de ellos, incluidos proveedores de comunicaciones, procesadores de pagos, empresas de alojamiento, proveedores de análisis, proveedores de inteligencia artificial, plataformas de contabilidad, proveedores de telecomunicaciones y otros proveedores de tecnología. Los servicios de terceros pueden regirse por términos y políticas de privacidad separados. Paperwork Monster no es responsable de los servicios de terceros que estén fuera de nuestro control razonable.",
        ),
      ],
    },
    {
      n: 19,
      heading: "Privacidad y seguridad",
      blocks: [
        p(
          "La recopilación, el uso y la divulgación de información personal se describen en nuestra Política de privacidad. Usamos medidas administrativas, técnicas y organizativas razonables diseñadas para proteger la información procesada a través de los Servicios. Ningún sistema electrónico puede garantizarse como completamente seguro, ininterrumpido o libre de errores, y no garantizamos una seguridad absoluta.",
        ),
      ],
    },
    {
      n: 20,
      heading: "Suspensión y terminación",
      blocks: [
        p(
          "Paperwork Monster puede suspender o dar por terminada una cuenta o una funcionalidad en particular si determinamos razonablemente que un pago está vencido; que la cuenta se está usando de forma fraudulenta; que el uso viola estos Términos, la ley aplicable o los requisitos de plataformas de terceros; que la actividad crea una amenaza de seguridad; que la actividad podría dañar sustancialmente a Paperwork Monster o a otros; o que la suspensión es razonablemente necesaria para proteger la integridad de los Servicios. Cuando sea razonablemente posible, podemos dar aviso y una oportunidad de resolver el problema. La terminación no elimina las obligaciones ni responsabilidades surgidas antes de la terminación.",
        ),
      ],
    },
    {
      n: 21,
      heading: "Datos después de la cancelación",
      blocks: [
        p(
          "Después de la terminación o cancelación de una cuenta de pago, Paperwork Monster puede poner los Datos del Cliente a disposición para su exportación durante un máximo de 30 días, sujeto al estado de la cuenta, la disponibilidad técnica, los requisitos legales y la funcionalidad aplicable del producto. Después de ese período, Paperwork Monster puede eliminar, anonimizar, archivar o de otro modo disponer de los Datos del Cliente conforme a sus prácticas de retención y obligaciones legales. Usted es responsable de exportar la información que desee conservar. Podemos conservar la información por más tiempo cuando sea necesario por motivos legales, de seguridad, prevención de fraude, respaldo, contabilidad, resolución de disputas o cumplimiento.",
        ),
      ],
    },
    {
      n: 22,
      heading: "Exclusión de garantías",
      blocks: [
        p(
          'EN LA MÁXIMA MEDIDA PERMITIDA POR LA LEY, LOS SERVICIOS SE PROPORCIONAN "TAL CUAL" Y "SEGÚN DISPONIBILIDAD". PAPERWORK MONSTER RENUNCIA A TODAS LAS GARANTÍAS, EXPRESAS O IMPLÍCITAS, INCLUIDAS LAS GARANTÍAS IMPLÍCITAS DE COMERCIABILIDAD, IDONEIDAD PARA UN FIN DETERMINADO, TITULARIDAD Y NO INFRACCIÓN. NO GARANTIZAMOS QUE LOS SERVICIOS SEAN ININTERRUMPIDOS, LIBRES DE ERRORES, COMPLETAMENTE SEGUROS O ADECUADOS PARA TODO FIN COMERCIAL.',
        ),
      ],
    },
    {
      n: 23,
      heading: "Limitación de responsabilidad",
      blocks: [
        p(
          "EN LA MÁXIMA MEDIDA PERMITIDA POR LA LEY, PAPERWORK MONSTER Y SUS DIRECTIVOS, DIRECTORES, EMPLEADOS, AFILIADOS, CONTRATISTAS Y PROVEEDORES DE SERVICIOS NO SERÁN RESPONSABLES POR DAÑOS INDIRECTOS, INCIDENTALES, ESPECIALES, CONSECUENTES, EJEMPLARES O PUNITIVOS, INCLUIDOS LUCRO CESANTE, PÉRDIDA DE INGRESOS, PÉRDIDA DE NEGOCIO, PÉRDIDA DE REPUTACIÓN O PÉRDIDA DE DATOS, QUE SURJAN DE LOS SERVICIOS O DE ESTOS TÉRMINOS O SE RELACIONEN CON ELLOS.",
        ),
        p(
          "EN LA MÁXIMA MEDIDA PERMITIDA POR LA LEY, LA RESPONSABILIDAD TOTAL AGREGADA DE PAPERWORK MONSTER QUE SURJA DE LOS SERVICIOS O DE ESTOS TÉRMINOS O SE RELACIONE CON ELLOS NO EXCEDERÁ EL MONTO QUE USTED PAGÓ A PAPERWORK MONSTER POR LOS SERVICIOS DURANTE LOS DOCE MESES INMEDIATAMENTE ANTERIORES AL HECHO QUE DIO ORIGEN A LA RECLAMACIÓN. NADA EN ESTOS TÉRMINOS EXCLUYE UNA RESPONSABILIDAD QUE NO PUEDA EXCLUIRSE LEGALMENTE.",
        ),
      ],
    },
    {
      n: 24,
      heading: "Indemnización",
      blocks: [
        p(
          "En la medida permitida por la ley, usted acepta defender, indemnizar y mantener indemne a Paperwork Monster y a sus directivos, directores, empleados, afiliados y agentes frente a reclamaciones de terceros, daños, responsabilidades, sanciones, sentencias y costos razonables que surjan de sus Datos del Cliente o se relacionen con ellos; de su violación de estos Términos o de la ley aplicable; de sus productos o servicios; de su relación o disputa con sus clientes; de las comunicaciones iniciadas o autorizadas a través de su cuenta; de su falta de obtención del consentimiento de comunicación legalmente requerido; o de la infracción o violación de derechos de terceros causada por la información o los materiales que usted proporcione.",
        ),
      ],
    },
    {
      n: 25,
      heading: "Ley aplicable",
      blocks: [
        p(
          "Estos Términos y las disputas que surjan de ellos se rigen por las leyes del Estado de Carolina del Sur, sin tener en cuenta sus principios sobre conflicto de leyes, salvo en la medida en que se aplique la ley federal.",
        ),
      ],
    },
    {
      n: 26,
      heading: "Resolución informal de disputas",
      blocks: [
        p(
          "Antes de iniciar un arbitraje, la parte que plantee una disputa debe dar aviso por escrito describiendo la naturaleza de la disputa y la resolución solicitada. Las partes harán esfuerzos razonables y de buena fe para resolver la disputa de manera informal durante al menos 30 días después de recibido el aviso, antes de iniciar el arbitraje.",
        ),
        p(
          "Los avisos a Paperwork Monster deben enviarse a: Paperwork Monster Inc., Atención: Legal, 4505 Socastee Blvd, Myrtle Beach, SC 29588, [INSERTAR CORREO LEGAL/DE SOPORTE].",
        ),
      ],
    },
    {
      n: 27,
      heading: "Arbitraje vinculante",
      blocks: [
        p(
          "Salvo lo dispuesto a continuación, toda disputa, reclamación o controversia que surja de estos Términos, de los Servicios o de la relación entre usted y Paperwork Monster, o que se relacione con ellos, y que no pueda resolverse mediante el proceso informal anterior, se resolverá mediante arbitraje final y vinculante de forma individual.",
        ),
        p(
          'El arbitraje será administrado por la American Arbitration Association ("AAA") conforme a sus Reglas de Arbitraje Comercial aplicables, a menos que la ley exija otro conjunto de reglas de la AAA. El arbitraje podrá llevarse a cabo de forma remota, a menos que el árbitro determine que es apropiada una audiencia presencial. Cada parte será responsable de las tarifas del arbitraje según lo dispuesto por las reglas de la AAA y la ley aplicables.',
        ),
        p(
          "El árbitro podrá otorgar cualquier remedio individual disponible conforme a la ley aplicable, pero no podrá consolidar las reclamaciones de personas que no sean parte del arbitraje a menos que ambas partes lo acuerden. Cualquiera de las partes podrá presentar una reclamación individual ante un tribunal de reclamos menores si la reclamación califica. Cualquiera de las partes también podrá solicitar medidas cautelares o temporales ante un tribunal competente para proteger la propiedad intelectual, la información confidencial, las cuentas, los sistemas o la seguridad mientras el arbitraje esté pendiente.",
        ),
      ],
    },
    {
      n: 28,
      heading: "Renuncia a acciones colectivas y a juicio por jurado",
      blocks: [
        p(
          "EN LA MÁXIMA MEDIDA PERMITIDA POR LA LEY, USTED Y PAPERWORK MONSTER ACUERDAN QUE LAS DISPUTAS SE RESOLVERÁN ÚNICAMENTE DE FORMA INDIVIDUAL Y NO COMO UNA ACCIÓN COLECTIVA, DE GRUPO, CONSOLIDADA O REPRESENTATIVA. USTED Y PAPERWORK MONSTER RENUNCIAN CADA UNO AL DERECHO A UN JUICIO POR JURADO PARA LAS RECLAMACIONES SUJETAS A ARBITRAJE.",
        ),
        p(
          "Si se determina que la renuncia a acciones colectivas no es exigible respecto de una reclamación o solicitud de remedio en particular, esa parte se separará y se tramitará según lo exija la ley aplicable.",
        ),
      ],
    },
    {
      n: 29,
      heading: "Cambios a estos Términos",
      blocks: [
        p(
          "Podemos actualizar estos Términos de vez en cuando. Si hacemos cambios sustanciales, daremos un aviso razonable a través de los Servicios, por correo electrónico, en el sitio web o por otro medio apropiado. Los Términos actualizados indicarán su fecha de vigencia. Cuando la ley aplicable exija la aceptación afirmativa de un cambio, solicitaremos esa aceptación.",
        ),
      ],
    },
    {
      n: 30,
      heading: "Disposiciones generales",
      blocks: [
        p(
          "Estos Términos, junto con los formularios de pedido aplicables, la Política de reembolsos y cancelaciones, la Política de privacidad y cualquier término adicional expresamente incorporado, constituyen el acuerdo que rige los Servicios. Si una disposición no es exigible, las demás disposiciones permanecen en vigor en la máxima medida permitida por la ley. Que no hagamos valer una disposición no constituye una renuncia.",
        ),
        p(
          "Usted no puede ceder estos Términos sin nuestro consentimiento, salvo como parte de una transferencia lícita de la totalidad o de una parte sustancial de su negocio o activos, sujeto a la ley aplicable. Paperwork Monster puede ceder estos Términos en relación con una fusión, adquisición, reorganización corporativa, financiamiento o venta de activos. Las disposiciones que por su naturaleza deban sobrevivir a la terminación sobrevivirán, incluidas las relativas a obligaciones de pago, propiedad, exclusiones de garantía, limitaciones de responsabilidad, indemnización, resolución de disputas y arbitraje.",
        ),
      ],
    },
    {
      n: 31,
      heading: "Contáctenos",
      blocks: [
        p(
          "Las preguntas sobre estos Términos pueden dirigirse a: Paperwork Monster Inc., 4505 Socastee Blvd, Myrtle Beach, SC 29588, [INSERTAR CORREO DE SOPORTE/LEGAL].",
        ),
      ],
    },
  ],
};

export const REFUND_POLICY_ES: LegalDoc = {
  id: "refunds",
  title: "Política de reembolsos y cancelaciones",
  effectiveDate: LEGAL_EFFECTIVE_DATE_ES,
  intro: [
    'Esta Política de reembolsos y cancelaciones se aplica a las suscripciones y servicios de pago comprados a Paperwork Monster Inc., que opera como Paperwork Monster ("Paperwork Monster," "nosotros," "nos" o "nuestro"). Esta Política forma parte de nuestros Términos de servicio.',
  ],
  sections: [
    {
      n: 1,
      heading: "Suscripciones recurrentes",
      blocks: [
        p(
          "Paperwork Monster puede ofrecer planes de suscripción mensuales, anuales u otros planes recurrentes. Salvo que se indique lo contrario al comprar un plan, las suscripciones mensuales se renuevan automáticamente cada mes, las suscripciones anuales se renuevan automáticamente cada año y los cargos de suscripción se facturan por adelantado para el período de suscripción aplicable. Su suscripción permanece activa hasta que se cancele.",
        ),
      ],
    },
    {
      n: 2,
      heading: "Cancelación",
      blocks: [
        p(
          "Puede cancelar su suscripción de pago en cualquier momento mediante la funcionalidad de cancelación disponible en su cuenta o comunicándose con Paperwork Monster por un canal de soporte autorizado. La cancelación evita que la suscripción se renueve por otro período de facturación. Salvo que se indique lo contrario, la cancelación no termina de inmediato el acceso a los Servicios que ya ha pagado; puede seguir usando las funciones de pago aplicables hasta el final de su período de suscripción pagado en curso.",
        ),
      ],
    },
    {
      n: 3,
      heading: "Planes mensuales",
      blocks: [
        p(
          "Si cancela una suscripción mensual, la cancelación entra en vigor al final del período de facturación mensual por el que ya se ha realizado el pago. No se hará ningún cargo de suscripción mensual adicional después de que la cancelación entre en vigor. Generalmente no ofrecemos reembolsos ni créditos prorrateados por las porciones no utilizadas de un período de facturación mensual.",
        ),
      ],
    },
    {
      n: 4,
      heading: "Planes anuales",
      blocks: [
        p(
          "Las cuotas de suscripción anual se cobran por el período de suscripción anual divulgado al momento de la compra. Si cancela una suscripción anual, la cancelación normalmente entra en vigor al final del período anual ya comprado. Las cuotas de suscripción anual generalmente no son reembolsables ni se prorratean según los meses o Servicios no utilizados, salvo que lo exija la ley o se indique expresamente en una oferta por escrito. Su suscripción anual no se renovará después de que su cancelación entre en vigor.",
        ),
      ],
    },
    {
      n: 5,
      heading: "Planes gratuitos",
      blocks: [
        p(
          "Paperwork Monster puede ofrecer un nivel de suscripción gratuito, incluido Monster Free. Una cuenta gratuita no genera un cargo de suscripción a menos que usted decida pasar a un plan de pago o se inscriba en otro servicio de pago. Las funciones y los límites de uso aplicables a los planes gratuitos pueden diferir de los planes de pago y pueden cambiar de forma prospectiva.",
        ),
      ],
    },
    {
      n: 6,
      heading: "Pruebas gratuitas",
      blocks: [
        p(
          "Paperwork Monster puede ofrecer pruebas gratuitas de planes de suscripción de pago. La duración de la prueba y los términos de conversión se divulgarán con la oferta aplicable. Si una prueba gratuita se ofrece sin requerir información de pago, el acceso a las funciones de pago puede terminar o volver a un plan gratuito cuando la prueba expire, a menos que compre una suscripción de pago. Si una prueba requiere información de pago y se divulga que se convierte automáticamente en una suscripción de pago, debe cancelar antes de la fecha límite de la prueba divulgada para evitar el primer cargo de suscripción. Una vez que se procesa un cargo de suscripción tras una conversión de prueba debidamente divulgada, se aplican las disposiciones ordinarias de reembolso de esta Política.",
        ),
      ],
    },
    {
      n: 7,
      heading: "Sin reembolsos prorrateados",
      blocks: [
        p(
          "Salvo que lo exija la ley o Paperwork Monster lo disponga expresamente, las cuotas de suscripción no son reembolsables por el simple hecho de que usted no haya usado los Servicios, los haya usado menos de lo esperado, haya dejado de usarlos antes de que terminara el período de suscripción, un empleado o usuario autorizado haya dejado de usar la cuenta, sus circunstancias comerciales hayan cambiado o haya cancelado después de que un período de suscripción ya hubiera comenzado.",
        ),
      ],
    },
    {
      n: 8,
      heading: "Errores de facturación y cobros duplicados",
      blocks: [
        p(
          "Si cree que se le cobró de forma incorrecta, comuníquese con Paperwork Monster con prontitud. Si confirmamos un error de facturación, un cobro duplicado o un cobro no autorizado del que Paperwork Monster sea responsable, podemos revertir el cobro, emitir un reembolso o aplicar un crédito a la cuenta según corresponda.",
        ),
      ],
    },
    {
      n: 9,
      heading: "Reembolsos y créditos discrecionales",
      blocks: [
        p(
          "Paperwork Monster puede, a su discreción, emitir reembolsos o créditos de servicio en circunstancias excepcionales. Emitir un reembolso o crédito en una situación no crea la obligación de ofrecer el mismo remedio en otra situación y no modifica esta Política.",
        ),
      ],
    },
    {
      n: 10,
      heading: "Cambios de precio",
      blocks: [
        p(
          "Podemos cambiar los precios de las suscripciones de forma prospectiva. Para las suscripciones existentes, un cambio de precio normalmente entrará en vigor en una renovación futura y no durante un período de facturación que ya se haya pagado. Daremos un aviso razonable de un cambio de precio sustancial que afecte a una suscripción existente. Puede cancelar antes de la renovación si no desea continuar con el nuevo precio.",
        ),
      ],
    },
    {
      n: 11,
      heading: "Suspensión o terminación por infracción",
      blocks: [
        p(
          "Si Paperwork Monster suspende o da por terminada una cuenta por falta de pago, fraude, actividad ilegal, abuso, problemas de seguridad, violación de nuestros Términos de servicio o conductas indebidas similares, las cuotas de suscripción previamente pagadas generalmente no son reembolsables. Usted sigue siendo responsable de los cargos legítimos incurridos antes de la terminación.",
        ),
      ],
    },
    {
      n: 12,
      heading: "Datos después de la cancelación",
      blocks: [
        p(
          "Después de la cancelación o terminación, Paperwork Monster puede poner los datos de la cuenta a disposición para su exportación durante un máximo de 30 días, sujeto a la funcionalidad del producto, el estado de la cuenta, los requisitos legales y la disponibilidad técnica. Después de ese período, los datos pueden eliminarse, anonimizarse, archivarse o conservarse conforme a nuestras prácticas de retención de datos y obligaciones legales. Los clientes son responsables de exportar la información que deseen conservar.",
        ),
      ],
    },
    {
      n: 13,
      heading: "Cómo solicitar ayuda con un problema de facturación",
      blocks: [
        p(
          "Las preguntas sobre cancelaciones, cargos de suscripción, reembolsos o errores de facturación pueden enviarse a Paperwork Monster Inc. a [INSERTAR CORREO DE SOPORTE] o a 4505 Socastee Blvd, Myrtle Beach, SC 29588. Incluya información suficiente para que podamos identificar la cuenta y la transacción correspondientes. No envíe por correo electrónico números completos de tarjetas de pago ni otra información de pago sensible innecesaria.",
        ),
      ],
    },
  ],
};

export const PRIVACY_POLICY_ES: LegalDoc = {
  id: "privacy",
  title: "Política de privacidad",
  effectiveDate: LEGAL_EFFECTIVE_DATE_ES,
  intro: [
    'Esta Política de privacidad explica cómo Paperwork Monster Inc., que opera como Paperwork Monster ("Paperwork Monster," "nosotros," "nos" o "nuestro"), recopila, usa, divulga y protege la información cuando las personas visitan nuestros sitios web, crean o usan una cuenta, interactúan con nuestros Servicios, se comunican con nosotros o interactúan de otro modo con Paperwork Monster. Nuestros Servicios están diseñados principalmente para empresas.',
  ],
  sections: [
    {
      n: 1,
      heading: "Información que recopilamos",
      blocks: [
        labeled(
          "Información de cuenta y de la empresa",
          "Podemos recopilar nombre, nombre de la empresa, dirección de la empresa, correo electrónico, número de teléfono, cargo o función, nombre de usuario y credenciales de la cuenta, preferencias de la cuenta, plan de suscripción, información de usuarios autorizados y otra información proporcionada al crear o administrar una cuenta.",
        ),
        labeled(
          "Información de facturación y transacciones",
          "Si compra Servicios de pago, nosotros y nuestros proveedores de procesamiento de pagos o servicios comerciales podemos recopilar la información necesaria para procesar la transacción, como el nombre y la dirección de facturación, el tipo de método de pago, el monto de la transacción, la fecha de la transacción, el estado del pago y los identificadores asociados a la transacción. La información de la tarjeta de pago puede ser manejada directamente por los procesadores de pago o proveedores de servicios comerciales en lugar de almacenarse directamente en Paperwork Monster.",
        ),
        labeled(
          "Información de clientes y CRM",
          "Los clientes pueden cargar o ingresar información sobre sus propios clientes, prospectos, empleados, subcontratistas, proveedores, trabajos o proyectos. Esta información puede incluir nombres, números de teléfono, correos electrónicos, direcciones de servicio, notas sobre clientes, información de citas, información de proyectos, estimados y cotizaciones, facturas, fotos, comunicaciones, registros de transacciones y demás información que el cliente decida almacenar a través de los Servicios. Paperwork Monster procesa esta información principalmente para prestar Servicios al cliente empresarial correspondiente.",
        ),
        labeled(
          "Documentos comerciales",
          "Si la funcionalidad relacionada está habilitada, los clientes pueden cargar documentos comerciales como certificados de seguro, licencias, permisos, formularios W-9, información de identificación fiscal, registros de proveedores o documentación comercial similar. No solicitamos números de Seguro Social, información de licencias de conducir, información de salud, información biométrica, información de verificación de antecedentes ni otra información personal altamente sensible como parte de nuestro proceso ordinario de registro de cuentas, a menos que una función futura la requiera específicamente y se proporcionen las divulgaciones apropiadas.",
        ),
        labeled(
          "Comunicaciones",
          "Podemos recopilar las comunicaciones enviadas a través de Paperwork Monster o dirigidas a Paperwork Monster, incluidas solicitudes de soporte, correos electrónicos, mensajes de chat, comunicaciones telefónicas, mensajes de texto, comentarios de clientes y comunicaciones transmitidas mediante la funcionalidad de la plataforma. Cuando la ley lo permita y se divulgue apropiadamente, las llamadas u otras interacciones con Paperwork Monster pueden grabarse o analizarse con fines de control de calidad, seguridad, soporte, capacitación o mejora del servicio.",
        ),
        labeled(
          "Información del dispositivo y de uso",
          "Cuando usa nuestros sitios web o Servicios, podemos recopilar automáticamente información como la dirección IP, el tipo de navegador, el tipo de dispositivo, el sistema operativo, las páginas o funciones a las que se accede, las fechas y horas de acceso, las páginas de referencia, la información de sesión, la información de errores y diagnóstico, la ubicación aproximada derivada de la dirección IP y las interacciones con los Servicios. Podemos usar cookies, píxeles, kits de desarrollo de software, almacenamiento local y tecnologías similares para autenticación, seguridad, análisis, preferencias, rendimiento y marketing.",
        ),
      ],
    },
    {
      n: 2,
      heading: "Cómo usamos la información",
      blocks: [
        p("Podemos usar la información para:"),
        list(
          "crear y administrar cuentas;",
          "prestar y operar los Servicios;",
          "autenticar usuarios;",
          "procesar pagos de suscripción;",
          "entregar las comunicaciones solicitadas;",
          "brindar soporte al cliente;",
          "mantener registros de clientes y proyectos;",
          "generar estimados, facturas, documentos, reportes u otros resultados solicitados;",
          "ofrecer funcionalidad habilitada con IA y automatizada;",
          "personalizar y mejorar los Servicios;",
          "entender el uso y el rendimiento de las funciones;",
          "desarrollar nuevas funciones;",
          "mantener la seguridad;",
          "prevenir fraude, spam, abuso y actividad no autorizada;",
          "resolver problemas técnicos;",
          "hacer cumplir nuestros acuerdos;",
          "comunicarnos sobre cuentas, suscripciones, actualizaciones y seguridad;",
          "enviar comunicaciones de marketing cuando esté permitido;",
          "cumplir con obligaciones legales; y",
          "establecer, ejercer o defender reclamaciones legales.",
        ),
      ],
    },
    {
      n: 3,
      heading: "Inteligencia artificial y procesamiento automatizado",
      blocks: [
        p(
          "Ciertas funciones pueden usar inteligencia artificial, aprendizaje automático o tecnologías automatizadas. La información enviada a estas funciones puede ser procesada por Paperwork Monster o por los proveedores de servicios que respaldan esas tecnologías con fines como generar los resultados solicitados, mejorar flujos de trabajo, resumir información, organizar información o realizar otras funciones solicitadas. Podemos establecer restricciones adicionales sobre la información que puede enviarse a las funciones habilitadas con IA. Los clientes no deben enviar información personal sensible innecesaria a las funciones de IA.",
        ),
      ],
    },
    {
      n: 4,
      heading: "Información sobre los clientes de nuestros clientes",
      blocks: [
        p(
          "Las empresas que usan Paperwork Monster pueden proporcionarnos información personal sobre sus clientes, prospectos, empleados, subcontratistas u otros contactos. En muchas circunstancias, Paperwork Monster procesa esta información en nombre del cliente empresarial que la ingresó en los Servicios. Esa empresa determina por qué se recopila la información, qué información se ingresa y cómo se usa a través de su cuenta.",
        ),
        p(
          "Si usted es cliente de una empresa que usa Paperwork Monster y tiene preguntas sobre la información que esa empresa mantiene sobre usted, en general debe comunicarse directamente con esa empresa. Podemos ayudar a nuestros clientes empresariales a responder a las solicitudes de privacidad apropiadas.",
        ),
      ],
    },
    {
      n: 5,
      heading: "Mensajes de texto, llamadas telefónicas y correo electrónico",
      blocks: [
        p(
          "Los Servicios pueden permitir a nuestros clientes empresariales comunicarse con sus clientes u otros contactos mediante mensajes de texto, llamadas telefónicas y correo electrónico. Cuando un cliente empresarial inicia estas comunicaciones a través de Paperwork Monster, esa empresa es responsable de obtener el consentimiento legalmente requerido y de atender las solicitudes de exclusión o revocación.",
        ),
        p(
          "Paperwork Monster y sus proveedores de servicios de comunicaciones pueden procesar la información de los destinatarios, los registros de consentimiento y los metadatos de las comunicaciones para transmitir, enrutar, proteger, diagnosticar, mantener y documentar estas comunicaciones. La información de suscripción móvil y los registros de consentimiento no se venden, alquilan ni transfieren a terceros para sus propios fines de marketing o promoción.",
        ),
        p(
          "Los destinatarios pueden darse de baja de las comunicaciones por mensaje de texto siguiendo las instrucciones proporcionadas con el programa de mensajería aplicable, incluidas palabras clave estándar como STOP cuando estén disponibles. Un destinatario que se haya dado de baja no debería recibir más mensajes a través del programa de mensajería aplicable, a menos que después otorgue un consentimiento válido para reanudarlos.",
        ),
      ],
    },
    {
      n: 6,
      heading: "Cómo divulgamos la información",
      blocks: [
        labeled(
          "Proveedores de servicios",
          "Podemos usar empresas que prestan servicios como alojamiento en la nube, infraestructura de comunicaciones, servicios de telefonía y SMS, entrega de correo electrónico, procesamiento de pagos, ciberseguridad, análisis, soporte al cliente, inteligencia artificial, desarrollo de software, almacenamiento de datos y servicios profesionales. Estos proveedores pueden procesar información según sea necesario para prestarnos servicios y Paperwork Monster no los autoriza a usar la información personal de los clientes para fines no relacionados.",
        ),
        labeled(
          "Por indicación suya",
          "Podemos divulgar información cuando usted nos lo indique, incluso cuando envía un estimado o una factura, transmite una comunicación, comparte un documento, activa una integración o solicita de otro modo que la información se proporcione a otra persona o servicio.",
        ),
        labeled(
          "Transacciones comerciales",
          "La información puede divulgarse como parte de una fusión, financiamiento, adquisición, venta de activos, reorganización corporativa, quiebra o transacción similar, real o contemplada, sujeto a las protecciones de confidencialidad apropiadas cuando corresponda.",
        ),
        labeled(
          "Fines legales y de seguridad",
          "Podemos divulgar información cuando creamos razonablemente que es necesario para cumplir con la ley aplicable, responder a un proceso legal válido, proteger los derechos o la propiedad de Paperwork Monster o de otros, investigar fraude o conductas ilegales, atender amenazas de seguridad, hacer cumplir nuestros acuerdos o proteger la seguridad de las personas.",
        ),
      ],
    },
    {
      n: 7,
      heading: "No vendemos información personal",
      blocks: [
        p(
          'Paperwork Monster no vende información personal a cambio de una contraprestación monetaria y no opera un modelo de negocio en el que la información de contacto de los clientes se venda a intermediarios de datos o a terceros no relacionados. Algunas leyes de privacidad usan definiciones más amplias de "venta", "compartir" o publicidad dirigida. Si nuestras prácticas futuras constituyen venta o compartición conforme a una ley de privacidad aplicable, proporcionaremos los avisos y las opciones que esa ley exija.',
        ),
      ],
    },
    {
      n: 8,
      heading: "Marketing",
      blocks: [
        p(
          "Podemos usar la información de contacto comercial para comunicarnos sobre productos, funciones, promociones, materiales educativos o eventos de Paperwork Monster cuando la ley lo permita. Puede darse de baja de las comunicaciones promocionales por correo electrónico usando el enlace para cancelar la suscripción incluido en esos correos. Darse de baja del marketing no nos impide enviar las comunicaciones transaccionales, de seguridad, facturación, cuenta o servicio que sean necesarias.",
        ),
      ],
    },
    {
      n: 9,
      heading: "Cookies y análisis",
      blocks: [
        p(
          "Podemos usar cookies y tecnologías similares para mantener sesiones, recordar preferencias, autenticar cuentas, detectar fraude, medir el tráfico del sitio web, entender el uso del producto, mejorar el rendimiento y evaluar la eficacia del marketing. Los controles del navegador pueden permitirle limitar ciertas cookies, aunque desactivar las cookies necesarias puede afectar la funcionalidad.",
        ),
      ],
    },
    {
      n: 10,
      heading: "Retención de datos",
      blocks: [
        p(
          "Conservamos la información durante el tiempo razonablemente necesario para prestar los Servicios y cumplir los fines descritos en esta Política, incluido el cumplimiento de obligaciones legales, contables, fiscales, de seguridad, prevención de fraude, resolución de disputas y contractuales.",
        ),
        p(
          "Después de la cancelación o terminación de una cuenta, los Datos del Cliente pueden permanecer disponibles para su exportación durante un máximo de 30 días, sujeto al estado de la cuenta, la disponibilidad técnica, los requisitos legales y la funcionalidad aplicable del producto. Después de ese período, la información puede eliminarse, anonimizarse, archivarse o conservarse cuando sea razonablemente necesario para fines comerciales o legales legítimos. La información puede persistir temporalmente en respaldos y sistemas de recuperación ante desastres.",
        ),
      ],
    },
    {
      n: 11,
      heading: "Seguridad de los datos",
      blocks: [
        p(
          "Usamos salvaguardas administrativas, técnicas y organizativas razonables diseñadas para proteger la información contra el acceso no autorizado, la pérdida, el uso indebido, la alteración o la divulgación. Sin embargo, ningún método de transmisión o almacenamiento electrónico es completamente seguro y no podemos garantizar una seguridad absoluta. Los clientes son responsables de mantener una seguridad de contraseñas y controles de acceso de usuarios apropiados para sus cuentas.",
        ),
      ],
    },
    {
      n: 12,
      heading: "Sus opciones de privacidad",
      blocks: [
        p(
          "Según su relación con Paperwork Monster y la ley aplicable, puede tener derechos sobre su información personal, que pueden incluir el derecho a solicitar el acceso, la corrección, la eliminación o una copia de cierta información; restringir u oponerse a cierto procesamiento; retirar el consentimiento cuando el procesamiento se base en el consentimiento; o excluirse de ciertos usos de la información. Estos derechos están sujetos a las excepciones y requisitos de verificación aplicables.",
        ),
        p(
          "Si Paperwork Monster procesa la información únicamente en nombre de uno de nuestros clientes empresariales, podemos dirigir su solicitud a ese cliente. Las solicitudes pueden enviarse a [INSERTAR CORREO DE PRIVACIDAD]. Podemos solicitar la información razonablemente necesaria para verificar su identidad o su autoridad para presentar una solicitud.",
        ),
      ],
    },
    {
      n: 13,
      heading: "Derechos de privacidad estatales",
      blocks: [
        p(
          "Los residentes de ciertos estados de EE. UU. pueden tener derechos de privacidad adicionales conforme a la ley estatal aplicable. Cuando dichas leyes se apliquen al procesamiento de Paperwork Monster, respetaremos los derechos legalmente requeridos, que pueden incluir acceso, corrección, eliminación, portabilidad de datos y derechos relativos a ciertas ventas, comparticiones o publicidad dirigida. No discriminaremos ilegalmente a una persona por ejercer un derecho de privacidad aplicable. Un agente autorizado puede presentar una solicitud cuando la ley lo permita y sujeto a la verificación apropiada.",
        ),
      ],
    },
    {
      n: 14,
      heading: "Privacidad de menores",
      blocks: [
        p(
          "Los Servicios están diseñados para empresas y no están destinados a menores de 18 años. No solicitamos a sabiendas que menores de 18 años creen cuentas empresariales. Si nos enteramos de que se ha recopilado información de un menor en circunstancias en las que la recopilación está prohibida, tomaremos las medidas apropiadas para eliminar o atender de otro modo esa información.",
        ),
      ],
    },
    {
      n: 15,
      heading: "Usuarios internacionales",
      blocks: [
        p(
          "Paperwork Monster opera principalmente en los Estados Unidos. Si la información se envía desde fuera de los Estados Unidos, puede procesarse y almacenarse en los Estados Unidos o en otras ubicaciones en las que operen nuestros proveedores de servicios. Pueden proporcionarse términos o divulgaciones adicionales si Paperwork Monster amplía sustancialmente los Servicios a jurisdicciones con requisitos de privacidad internacionales específicos.",
        ),
      ],
    },
    {
      n: 16,
      heading: "Servicios e integraciones de terceros",
      blocks: [
        p(
          "Los Servicios pueden contener integraciones, enlaces o funcionalidad proporcionados por terceros. La información que usted decida enviar a un servicio de terceros también está sujeta a las prácticas de privacidad de ese tercero. Paperwork Monster no es responsable de las prácticas de privacidad independientes de terceros.",
        ),
      ],
    },
    {
      n: 17,
      heading: "Cambios a esta Política de privacidad",
      blocks: [
        p(
          "Podemos actualizar esta Política de privacidad de vez en cuando. La Política revisada indicará su fecha de vigencia. Si hacemos cambios sustanciales, podemos dar un aviso adicional a través de nuestro sitio web, los Servicios, el correo electrónico u otro método de comunicación apropiado.",
        ),
      ],
    },
    {
      n: 18,
      heading: "Contáctenos",
      blocks: [
        p(
          "Para preguntas sobre esta Política de privacidad o las prácticas de privacidad de Paperwork Monster, contacte a: Paperwork Monster Inc., Atención: Privacidad, 4505 Socastee Blvd, Myrtle Beach, SC 29588, [INSERTAR CORREO DE PRIVACIDAD/SOPORTE].",
        ),
      ],
    },
  ],
};

/** The three documents in Spanish, in the order /terms renders them. */
export const LEGAL_DOCS_ES: readonly LegalDoc[] = [
  TERMS_OF_SERVICE_ES,
  REFUND_POLICY_ES,
  PRIVACY_POLICY_ES,
];
