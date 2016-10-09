export const wait_seconds = function (senconds: number) {
    return new Promise(resolve => setTimeout(resolve, senconds * 1000));
}
//返回一个对象，该对象既要有first对象的所有属性，也要有second对象的额外属性。如果first和second有相同属性，则取first的属性的值：
export const defaults = function defaults<T, U>(first: T, second: U): T & U {//注意写法，是&
    let result = <T & U>{};
    for (let id in first) {
        (<any>result)[id] = (<any>first)[id];
    }
    for (let id in second) {
        if (!result.hasOwnProperty(id)) {//如果first和second对象有重复的属性，则保留first的
            (<any>result)[id] = (<any>second)[id];
        }
    }
    return result;
}
//返回一个对象，该对象既要有first对象的所有属性，也要有second对象的额外属性。如果first和second有相同属性，则取second的属性的值：
export const extend = function extend<T, U>(first: T, second: U): T & U {//注意写法，是&
    let result = <T & U>{};
    for (let id in first) {
        (<any>result)[id] = (<any>first)[id];
    }
    for (let id in second) {
        (<any>result)[id] = (<any>second)[id];
    }
    return result;
}