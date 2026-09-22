export const RESPONSE_SCHEMA={type:'object',additionalProperties:false,required:['css','coverage','unresolved','assumptions','externalDependencies'],properties:{
  css:{type:'string'},
  coverage:{type:'array',items:{type:'object',additionalProperties:false,required:['sourceIds','disposition','reason'],properties:{
    sourceIds:{type:'array',items:{type:'string'}},
    disposition:{type:'string',enum:['converted','dependency','not_applicable','external_ionic','unresolved']},reason:{type:'string'}}}},
  unresolved:{type:'array',items:{type:'string'}},assumptions:{type:'array',items:{type:'string'}},externalDependencies:{type:'array',items:{type:'string'}}}};

