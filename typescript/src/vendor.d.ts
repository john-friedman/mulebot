declare module 'mulebot:context' {
  export const documentation: string;
  export const schema: string;
}

declare module 'sql.js/dist/sql-asm.js' {
  import initSqlJs from 'sql.js';
  export default initSqlJs;
}
