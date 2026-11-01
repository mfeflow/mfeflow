/** Names of `:params` in a path template, e.g. `'/orders/:orderId/items/:itemId'` gives `'orderId' | 'itemId'`. */
export type PathParams<P extends string> = P extends `${string}:${infer Param}/${infer Rest}`
  ? Param | PathParams<`/${Rest}`>
  : P extends `${string}:${infer Param}`
    ? Param
    : never;

type PathOf<T extends string> = T extends `${infer Path}?${string}` ? Path : T;
type QueryOf<T extends string> = T extends `${string}?${infer Query}` ? Query : never;
type QueryKeys<Q extends string> = Q extends `${infer Head}&${infer Rest}`
  ? Head | QueryKeys<Rest>
  : Q;

/** Search params a template names after `?`: `'/search?q&page?'` has required `q` and optional `page`. */
export type RequiredSearch<T extends string> = Exclude<QueryKeys<QueryOf<T>>, `${string}?`>;
export type OptionalSearch<T extends string> =
  Extract<QueryKeys<QueryOf<T>>, `${string}?`> extends `${infer Key}?` ? Key : never;

export type ParamValue = string | number;
export type SearchValue = string | number | boolean;

type Obj<K extends string, V> = { readonly [P in K]: V };

/** What a link to a route needs: its path params, its required search params, and optional extras. */
export type LinkOptions<T extends string> = (PathParams<PathOf<T>> extends never
  ? { params?: undefined }
  : { params: Obj<PathParams<PathOf<T>>, ParamValue> }) &
  (RequiredSearch<T> extends never
    ? { search?: Partial<Obj<OptionalSearch<T>, SearchValue | undefined>> }
    : {
        search: Obj<RequiredSearch<T>, SearchValue> &
          Partial<Obj<OptionalSearch<T>, SearchValue | undefined>>;
      }) & { hash?: string };

type NeedsOptions<T extends string> = [PathParams<PathOf<T>> | RequiredSearch<T>] extends [never]
  ? false
  : true;

/** `[options?]` for a route with nothing required, `[options]` otherwise. */
export type LinkArgs<T extends string> =
  NeedsOptions<T> extends true ? [options: LinkOptions<T>] : [options?: LinkOptions<T>];

/** A route is a path template, optionally followed by `?` and its search params. */
export type RouteTable = Readonly<Record<string, string>>;

/** One remote's routes: where the shell mounts it and the paths inside. */
export interface RouteSet<R extends RouteTable = RouteTable> {
  readonly mount: string;
  readonly routes: R;
}

export type RouteSets = Readonly<Record<string, RouteSet>>;

/** `catalog.product`: the remote's name, a dot, the route's name. */
export type LinkId<S extends RouteSets> = {
  [Remote in keyof S & string]: `${Remote}.${keyof S[Remote]['routes'] & string}`;
}[keyof S & string];

export type TemplateOf<
  S extends RouteSets,
  Id extends string,
> = Id extends `${infer Remote}.${infer Name}`
  ? Remote extends keyof S
    ? Name extends keyof S[Remote]['routes']
      ? S[Remote]['routes'][Name] & string
      : never
    : never
  : never;
