import fs from "node:fs/promises";
import path from "node:path";

const viewsDirectory=path.join(process.cwd(),"views");

export async function loadView(
    fileName: string):Promise<string>{
        const filePath=path.join(viewsDirectory,fileName);
        return fs.readFile(filePath,"utf-8");
    }

export function fillTemplate(
    template:string,
    values:Record<string,string>
):string{
    let result=template;
    for (const [key,value] of Object.entries(values)){
        result=result.replaceAll(
            `{{${key}}}`,value
        );
    }
    return result;
}

export async function renderPage(
    title:string,
    contentFile: string,
    values: Record<string,string>,
    navigation: string
): Promise<string>{
    const [layout, contentTemplate]=await Promise.all([
        loadView("layout.html"),
        loadView(contentFile)
    ]);
    const content=fillTemplate(contentTemplate,values);
    return fillTemplate(layout,{
        TITLE:title,
        NAVIGATION: navigation,
        CONTENT: content
    });
}

